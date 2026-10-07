# ADR 0002 - Serialized asset domain model

Status: accepted (detail lands in Phase 2)

- Every sellable unit is a unique physical asset: serial number, grade, repair
  history, cost basis, warranty. We do NOT model refurb stock as generic SKUs.
- Asset lifecycle is a state machine:
  received -> tested -> in_repair -> graded -> listed -> reserved -> sold -> shipped
  (terminal alternates: returned, scrapped).
- stock_movements is an append-only, monthly-partitioned ledger; no updates/deletes.
  Corrections are compensating entries. Balances come from ledger rollups.
- Reservations: short transaction with SELECT ... FOR UPDATE SKIP LOCKED against
  listed units; TTL-based release handled by the background worker. Two customers
  can never hold the same unit.
- Staff mutations (grading, stock, pricing) write to an append-only audit table.