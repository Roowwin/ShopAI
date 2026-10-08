from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AuditEntry


async def audit(db: AsyncSession, actor_type: str, entity: str, action: str,
                entity_id: int | None = None, actor_id: int | None = None,
                before: dict[str, Any] | None = None, after: dict[str, Any] | None = None,
                meta: dict[str, Any] | None = None) -> None:
    """Adds an audit row inside the CALLER'S transaction (no commit here)."""
    db.add(AuditEntry(actor_type=actor_type, entity=entity, action=action,
                      entity_id=entity_id, actor_id=actor_id,
                      before=before, after=after, meta=meta))