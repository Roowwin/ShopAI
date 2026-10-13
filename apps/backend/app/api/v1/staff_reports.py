"""The Reports door: sales trends, top performers, inventory turnover, and their exports.

WHY THE WHOLE DOOR IS ADMIN. These screens are revenue, margin and stock value - the same numbers the
P&L states - and the owner's rule for this platform is that financial reporting is the admin's alone
(the Finance Guard). A leaderboard ranked by margin is a financial statement with a different layout,
so it sits behind the same wall rather than beside it. Nothing here is in `staff_ops.GUARDED_ACTIONS`,
so `_require_role` is called with `db=None` and an agent identity is refused outright.

WHY EXPORTS ARE AUDITED AND READS ARE NOT. Reading a screen is ephemeral; an export is a COPY of the
books that leaves the building and will be opened somewhere this platform cannot see. So every export
writes an audit row naming the report, the format and the window - which is the only way "who
downloaded the sales figures" is answerable later.

ONE DEFINITION PER REPORT, TWO OUTPUTS. The JSON endpoints and the export endpoints both call the
same `analytics` functions with the same arguments; the export adds only the seller header block and
a serialisation. A CSV that disagreed with the screen it was downloaded from would be the worst
possible bug in a reporting module, and sharing the function is what makes it impossible.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.exc import SQLAlchemyError

from app.api.v1.deps import require_roles
from app.api.v1.staff_ops import _409, _require_role
from app.core.db import get_db
from app.services import analytics
from app.services import report_export as exporter
from app.services.audit import audit

router = APIRouter(prefix="/staff/reports", tags=["staff-reports"])

# See the module docstring: financial reporting is the admin's, consistently with the Finance Guard.
ROLES_REPORTS = ("admin",)
ACTION_READ_REPORTS = "read_reports"
ACTION_EXPORT_REPORTS = "export_reports"


def _refuse(e: analytics.ReportError) -> None:
    raise HTTPException(status_code=422, detail=str(e))


async def _sales(db, days: int, channel: str | None, category: str | None) -> dict:
    try:
        return await analytics.sales_trends(db, days=days, channel=channel, category=category)
    except analytics.ReportError as e:
        _refuse(e)


@router.get("/sales-trends")
async def sales_trends(days: int = Query(30), channel: str | None = None,
                       category: str | None = None,
                       staff: dict = Depends(require_roles(*ROLES_REPORTS)), db=Depends(get_db)):
    """Revenue (ex-GST), GST collected, orders and units, one point per day."""
    await _require_role(staff, ROLES_REPORTS, ACTION_READ_REPORTS, None)
    return await _sales(db, days, channel, category)


@router.get("/top-performers")
async def top_performers(days: int = Query(30), channel: str | None = None,
                         category: str | None = None, limit: int = Query(20, ge=1, le=100),
                         staff: dict = Depends(require_roles(*ROLES_REPORTS)), db=Depends(get_db)):
    """The product leaderboard: units, revenue, margin, and units per day."""
    await _require_role(staff, ROLES_REPORTS, ACTION_READ_REPORTS, None)
    try:
        return await analytics.top_performers(db, days=days, channel=channel, category=category,
                                              limit=limit)
    except analytics.ReportError as e:
        _refuse(e)


@router.get("/inventory")
async def inventory(dead_days: int = Query(analytics.DEAD_STOCK_DAYS, ge=0, le=3650),
                    limit: int = Query(300, ge=1, le=2000),
                    staff: dict = Depends(require_roles(*ROLES_REPORTS)), db=Depends(get_db)):
    """Days in the warehouse per unit, with dead stock flagged."""
    await _require_role(staff, ROLES_REPORTS, ACTION_READ_REPORTS, None)
    try:
        return await analytics.inventory(db, dead_days=dead_days, limit=limit)
    except analytics.ReportError as e:
        _refuse(e)


@router.get("/export")
async def export(report: str = Query(description="sales-trends | top-performers | inventory"),
                 format: str = Query("csv", description="csv | pdf"),
                 days: int = Query(30), channel: str | None = None, category: str | None = None,
                 dead_days: int = Query(analytics.DEAD_STOCK_DAYS, ge=0, le=3650),
                 staff: dict = Depends(require_roles(*ROLES_REPORTS)), db=Depends(get_db)):
    """One report as a file, headed with the business's own legal identity and its GST split out."""
    await _require_role(staff, ROLES_REPORTS, ACTION_EXPORT_REPORTS, None)
    try:
        if report == "sales-trends":
            data = await _sales(db, days, channel, category)
        elif report == "top-performers":
            data = await analytics.top_performers(db, days=days, channel=channel,
                                                  category=category, limit=100)
        elif report == "inventory":
            data = await analytics.inventory(db, dead_days=dead_days, limit=2000)
        else:
            raise analytics.ReportError("report must be one of: "
                                        + ", ".join(exporter.REPORTS))
        payload, filename, content_type = exporter.render(
            report, format, await exporter.seller_header(db), data,
            datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"))
    except analytics.ReportError as e:
        _refuse(e)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    await audit(db, "staff", entity="report", action="report_exported", actor_id=staff["id"],
                after={"report": report, "format": format, "days": days,
                       "channel": channel, "category": category, "filename": filename})
    try:
        await db.commit()
    except SQLAlchemyError as e:
        await db.rollback(); _409(e)
    return Response(content=payload, media_type=content_type,
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})
