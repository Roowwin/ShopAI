"""Exports: the same report as a spreadsheet and as a document.

WHY THE HEADER BLOCK IS MADE OF THE SETTINGS STORE. An export leaves this platform and lands on an
accountant's desk, where a sheet with no seller on it is a sheet nobody can file. The business's own
legal name, ABN and registered address are already recorded (Settings & System) and already print on
every invoice, so the export reads THAT - one place the business describes itself, rather than a
second copy in a source constant that drifts the first time the address changes.

GST IS A COLUMN, NEVER INSIDE REVENUE. Revenue is ex-GST and the tax collected sits beside it, the
same split the ledger's statement uses - an export that reported `total_cents` as revenue would
overstate profit by the tax rate on every line, which is exactly the error the P&L module exists to
avoid. The final column reconciles the two so a reader can check the arithmetic in one row.

CSV IS FOR A SPREADSHEET, PDF IS FOR A PERSON. So the CSV carries bare numbers (`1234.56`, no
symbol, no thousands separator) that Excel parses as numbers, and the PDF carries the formatted
`$1,234.56` a human reads. Same figures, two audiences.
"""

import csv
import io

from app.services import system_settings as ss
from app.services.report_pdf import MARGIN, Pdf


def money(cents: int | None) -> str:
    return f"${(int(cents or 0) / 100):,.2f}"


def plain(cents: int | None) -> str:
    return f"{(int(cents or 0) / 100):.2f}"


async def seller_header(db) -> dict:
    """The business's own identity for the header block; blanks when Settings has none yet."""
    try:
        return await ss.get_business_identity(db)
    except Exception:
        return {"legal_name": "", "tax_id": "", "address": "", "email": ""}


def _header_lines(seller: dict, title: str, period: str, generated: str) -> list[str]:
    out = [seller.get("legal_name") or "RFO"]
    if seller.get("tax_id"):
        out.append("ABN " + seller["tax_id"])
    for line in (seller.get("address") or "").splitlines():
        if line.strip():
            out.append(line.strip())
    if seller.get("email"):
        out.append(seller["email"])
    out.append("")
    out.append(title)
    out.append(period)
    out.append("Generated " + generated)
    return out


# ---------------------------------------------------------------------------
# CSV
# ---------------------------------------------------------------------------
def _csv(rows: list[list]) -> bytes:
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\r\n")
    for r in rows:
        w.writerow(r)
    # Excel on Windows wants a BOM to read UTF-8; without it a customer name with an accent mojibakes.
    return b"\xef\xbb\xbf" + buf.getvalue().encode("utf-8")


def sales_trends_csv(seller: dict, data: dict, generated: str) -> bytes:
    rows: list[list] = [[line] for line in _header_lines(
        seller, "Sales trend", f"Last {data['days']} days ({data['from']} to {data['to']})", generated)]
    rows.append([])
    if data.get("channel"):
        rows.append([f"Channel: {data['channel']}"])
    if data.get("category"):
        rows.append([f"Category: {data['category']}"])
    rows.append(["Date", "Orders", "Units", "Revenue (ex GST)", "GST collected", "Total (inc GST)"])
    for p in data["series"]:
        rows.append([p["date"], p["orders"], p["units"], plain(p["revenue_cents"]),
                     plain(p["gst_cents"]), plain(p["revenue_cents"] + p["gst_cents"])])
    t = data["totals"]
    rows.append(["TOTAL", t["orders"], t["units"], plain(t["revenue_cents"]),
                 plain(t["gst_cents"]), plain(t["revenue_cents"] + t["gst_cents"])])
    return _csv(rows)


def top_performers_csv(seller: dict, data: dict, generated: str) -> bytes:
    rows: list[list] = [[line] for line in _header_lines(
        seller, "Top performers", f"Last {data['days']} days", generated)]
    rows.append([])
    rows.append(["Rank", "Product", "Category", "Units sold", "Revenue (ex GST)",
                 "Cost of goods", "Margin", "Margin %", "Units per day"])
    for i, p in enumerate(data["by_revenue"], start=1):
        rows.append([i, p["title"], p["category"], p["units"], plain(p["revenue_cents"]),
                     plain(p["cogs_cents"]), plain(p["margin_cents"]), f"{p['margin_pct']:.1f}",
                     f"{p['velocity_per_day']:.3f}"])
    tot_rev = sum(p["revenue_cents"] for p in data["products"])
    tot_cogs = sum(p["cogs_cents"] for p in data["products"])
    rows.append(["", "TOTAL", "", sum(p["units"] for p in data["products"]), plain(tot_rev),
                 plain(tot_cogs), plain(tot_rev - tot_cogs), "", ""])
    return _csv(rows)


def inventory_csv(seller: dict, data: dict, generated: str) -> bytes:
    s = data["summary"]
    rows: list[list] = [[line] for line in _header_lines(
        seller, "Inventory turnover", f"As at {data['as_of'][:10]} (dead stock after "
        f"{data['dead_days']} days listed)", generated)]
    rows.append([])
    rows.append([f"Units in stock: {s['units_in_stock']}",
                 f"Stock value (at cost): {plain(s['stock_value_cents'])}",
                 f"Dead stock: {s['dead_units']} units",
                 f"Dead value (at cost): {plain(s['dead_value_cents'])}"])
    rows.append([])
    rows.append(["Asset", "Product", "Category", "Status", "Grade", "Days in warehouse",
                 "Listed", "Days listed", "Cost", "Sale price", "Dead stock"])
    for u in data["units"]:
        rows.append([u["asset_id"], u["title"], u["category"], u["status"], u["grade"] or "",
                     f"{u['days_in_warehouse']:.1f}", u["listed_at"] or "",
                     "" if u["days_listed"] is None else f"{u['days_listed']:.1f}",
                     plain(u["cost_cents"]),
                     "" if u["sale_price_cents"] is None else plain(u["sale_price_cents"]),
                     "YES" if u["dead"] else ""])
    return _csv(rows)


# ---------------------------------------------------------------------------
# PDF
# ---------------------------------------------------------------------------
# Column x positions, in points from the left margin. Each report's table is laid out once here so
# the header row and the body rows cannot disagree about where a column lives.
COLS = {
    "sales":   [(0, "Date"), (110, "Orders"), (160, "Units"), (215, "Revenue (ex GST)"),
                (320, "GST collected"), (420, "Total (inc GST)")],
    "top":     [(0, "#"), (20, "Product"), (210, "Units"), (250, "Revenue"), (320, "Margin"),
                (390, "Margin %"), (450, "Units/day")],
    "stock":   [(0, "Asset"), (55, "Product"), (215, "Status"), (275, "Days in"), (330, "Listed"),
                (385, "Days listed"), (450, "Cost"), (500, "Dead")],
}


def _pdf_shell(title: str, seller: dict, subtitle: str, generated: str) -> Pdf:
    pdf = Pdf(title)
    for line in _header_lines(seller, title, subtitle, generated):
        pdf.text(MARGIN, line, size=12 if line == title else 10, bold=(line == title))
        pdf.space(1.1)
    pdf.space(0.5)
    return pdf


def sales_trends_pdf(seller: dict, data: dict, generated: str) -> bytes:
    pdf = _pdf_shell("Sales trend",
                     seller, f"Last {data['days']} days ({data['from']} to {data['to']})", generated)
    if data.get("channel") or data.get("category"):
        pdf.text(MARGIN, (f"Channel: {data.get('channel') or 'all'}    "
                          f"Category: {data.get('category') or 'all'}"), size=9)
        pdf.space()
    pdf.rule(); pdf.space(0.4)
    pdf.row([(MARGIN + x, h) for x, h in COLS["sales"]], bold=True); pdf.space(0.2)
    pdf.rule(); pdf.space(0.4)
    for p in data["series"]:
        pdf.ensure()
        pdf.row([(MARGIN + 0, p["date"]), (MARGIN + 110, str(p["orders"])),
                 (MARGIN + 160, str(p["units"])), (MARGIN + 215, money(p["revenue_cents"])),
                 (MARGIN + 320, money(p["gst_cents"])),
                 (MARGIN + 420, money(p["revenue_cents"] + p["gst_cents"]))])
    t = data["totals"]
    pdf.space(0.4); pdf.rule(); pdf.space(0.4)
    pdf.row([(MARGIN + 0, "TOTAL"), (MARGIN + 110, str(t["orders"])),
             (MARGIN + 160, str(t["units"])), (MARGIN + 215, money(t["revenue_cents"])),
             (MARGIN + 320, money(t["gst_cents"])),
             (MARGIN + 420, money(t["revenue_cents"] + t["gst_cents"]))], bold=True)
    pdf.space(1.5)
    pdf.text(MARGIN, "Revenue is stated EXCLUDING GST. GST collected is held on the tax "
                     "authority's behalf and is shown separately.", size=8)
    return pdf.to_bytes()


def top_performers_pdf(seller: dict, data: dict, generated: str) -> bytes:
    pdf = _pdf_shell("Top performers", seller, f"Last {data['days']} days", generated)
    pdf.rule(); pdf.space(0.4)
    pdf.row([(MARGIN + x, h) for x, h in COLS["top"]], bold=True); pdf.space(0.2)
    pdf.rule(); pdf.space(0.4)
    for i, p in enumerate(data["by_revenue"], start=1):
        pdf.ensure()
        pdf.row([(MARGIN + 0, str(i)), (MARGIN + 20, p["title"][:34]),
                 (MARGIN + 210, str(p["units"])), (MARGIN + 250, money(p["revenue_cents"])),
                 (MARGIN + 320, money(p["margin_cents"])), (MARGIN + 390, f"{p['margin_pct']:.1f}%"),
                 (MARGIN + 450, f"{p['velocity_per_day']:.3f}")])
    tot_rev = sum(p["revenue_cents"] for p in data["products"])
    tot_cogs = sum(p["cogs_cents"] for p in data["products"])
    pdf.space(0.4); pdf.rule(); pdf.space(0.4)
    pdf.row([(MARGIN + 20, "TOTAL"), (MARGIN + 210, str(sum(p["units"] for p in data["products"]))),
             (MARGIN + 250, money(tot_rev)), (MARGIN + 320, money(tot_rev - tot_cogs))], bold=True)
    pdf.space(1.5)
    pdf.text(MARGIN, "Margin is revenue EXCLUDING GST less cost of goods at the same cost basis the "
                     "shelf uses (cost, else settlement).", size=8)
    return pdf.to_bytes()


def inventory_pdf(seller: dict, data: dict, generated: str) -> bytes:
    s = data["summary"]
    pdf = _pdf_shell("Inventory turnover", seller,
                     f"As at {data['as_of'][:10]} - dead stock after {data['dead_days']} days listed",
                     generated)
    pdf.text(MARGIN, f"Units in stock {s['units_in_stock']}    "
                     f"Stock value at cost {money(s['stock_value_cents'])}    "
                     f"Dead stock {s['dead_units']} units ({money(s['dead_value_cents'])} at cost)",
             size=9)
    pdf.space(1.2)
    pdf.rule(); pdf.space(0.4)
    pdf.row([(MARGIN + x, h) for x, h in COLS["stock"]], bold=True); pdf.space(0.2)
    pdf.rule(); pdf.space(0.4)
    for u in data["units"]:
        pdf.ensure()
        pdf.row([(MARGIN + 0, f"#{u['asset_id']}"), (MARGIN + 55, (u["title"] or "")[:26]),
                 (MARGIN + 215, u["status"]), (MARGIN + 275, f"{u['days_in_warehouse']:.0f}"),
                 (MARGIN + 330, (u["listed_at"] or "")[:10]),
                 (MARGIN + 385, "" if u["days_listed"] is None else f"{u['days_listed']:.0f}"),
                 (MARGIN + 450, money(u["cost_cents"])), (MARGIN + 500, "YES" if u["dead"] else "")])
    pdf.space(1.5)
    pdf.text(MARGIN, "Dead stock is a unit still LISTED more than the threshold after it went on "
                     "sale. Units in refurbishment are not counted as dead.", size=8)
    return pdf.to_bytes()


REPORTS = {
    "sales-trends": (sales_trends_csv, sales_trends_pdf),
    "top-performers": (top_performers_csv, top_performers_pdf),
    "inventory": (inventory_csv, inventory_pdf),
}


def render(report: str, fmt: str, seller: dict, data: dict, generated: str) -> tuple[bytes, str, str]:
    """(bytes, filename, content-type) for one report in one format."""
    if report not in REPORTS:
        raise ValueError("report must be one of: " + ", ".join(REPORTS))
    if fmt not in ("csv", "pdf"):
        raise ValueError("format must be csv or pdf")
    csv_fn, pdf_fn = REPORTS[report]
    stamp = generated[:10]
    if fmt == "csv":
        return csv_fn(seller, data, generated), f"{report}-{stamp}.csv", "text/csv; charset=utf-8"
    return pdf_fn(seller, data, generated), f"{report}-{stamp}.pdf", "application/pdf"
