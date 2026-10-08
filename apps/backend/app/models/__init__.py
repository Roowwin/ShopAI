from sqlalchemy.orm import DeclarativeBase

class Base(DeclarativeBase):
    pass

from app.models.warehouse import Asset, AuditEntry, Lot, StockMovement  # noqa: E402,F401