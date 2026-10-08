from sqlalchemy.orm import DeclarativeBase

class Base(DeclarativeBase):
    pass

from app.models.warehouse import Asset, AuditEntry, Lot, StockMovement  # noqa: E402,F401
from app.models.catalog import Brand, Category, Product  # noqa: E402,F401
