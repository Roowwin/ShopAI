import uuid

from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Integer, String, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models import Base


class Lot(Base):
    __tablename__ = "lots"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    public_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), unique=True, server_default=text("gen_random_uuid()"))
    lot_number: Mapped[str] = mapped_column(String, unique=True)
    status: Mapped[str] = mapped_column(String)
    warehouse: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    # The supplier workbook's batch columns (0015_excel_foundation). They sit on the lot because
    # every unit in one lot shares them, even though the sheet repeats them on every row.
    load_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    account: Mapped[str | None] = mapped_column(Text, nullable=True)
    zone: Mapped[str | None] = mapped_column(Text, nullable=True)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    assets: Mapped[list["Asset"]] = relationship(back_populates="lot")


class Asset(Base):
    __tablename__ = "assets"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    public_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), unique=True, server_default=text("gen_random_uuid()"))
    product_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("products.id"), nullable=True)
    serial_number: Mapped[str | None] = mapped_column(Text, nullable=True)
    imei: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String)
    grade: Mapped[str | None] = mapped_column(String, nullable=True)
    cost_cents: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    sale_price_cents: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    intake_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    location: Mapped[str | None] = mapped_column(Text, nullable=True)
    condition_report: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    lot_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("lots.id"), nullable=False)

    # The supplier workbook's per-unit columns (0015_excel_foundation). Every one is nullable: they
    # are absent from the catalogue's existing rows and from nine columns of a partly-filled sheet,
    # and NULL is the honest reading of "this workbook does not track it" - distinctly not a False
    # on `on_shelf`, which would be a claim the sheet never made.
    asset: Mapped[str | None] = mapped_column(Text, nullable=True)
    # `class` is a reserved word in Python, so the attribute carries the column's name explicitly.
    asset_class: Mapped[str | None] = mapped_column("class", Text, nullable=True)
    model_number: Mapped[str | None] = mapped_column(Text, nullable=True)
    upgrade: Mapped[str | None] = mapped_column(Text, nullable=True)
    upgrade_desc: Mapped[str | None] = mapped_column(Text, nullable=True)
    audit_desc: Mapped[str | None] = mapped_column(Text, nullable=True)
    cosmetics_desc: Mapped[str | None] = mapped_column(Text, nullable=True)
    functional_desc: Mapped[str | None] = mapped_column(Text, nullable=True)
    fmv_cents: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    settlement_cents: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    channel: Mapped[str | None] = mapped_column(Text, nullable=True)
    on_shelf: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    pallet: Mapped[str | None] = mapped_column(Text, nullable=True)
    sku: Mapped[str | None] = mapped_column(Text, nullable=True)

    lot: Mapped["Lot"] = relationship(back_populates="assets")


class StockMovement(Base):
    __tablename__ = "stock_movements"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    moved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), primary_key=True, server_default=func.now())
    asset_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("assets.id"), nullable=False)
    qty: Mapped[int] = mapped_column(Integer, nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    actor_staff_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)


class AuditEntry(Base):
    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    actor_type: Mapped[str] = mapped_column(String)
    actor_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    entity: Mapped[str] = mapped_column(String)
    entity_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    action: Mapped[str] = mapped_column(Text)
    before: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    after: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    meta: Mapped[dict | None] = mapped_column(JSONB, nullable=True)