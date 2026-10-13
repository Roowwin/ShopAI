VERDICT: PASS

Fast-lane landing (owner directive: gates then ship). Recorded honestly.

- The consolidation is a MOVE and a DELETION, not a new layer: the queue, the fulfilment document,
  the label booking and the label read all now live in `staff_logistics.py`, which was already the
  rail that owns `shipments`. `services/carriers.py` stays a service - a carrier client is not a
  route and has no business in a router.
- `api/v1/staff_shipping.py` is deleted and unregistered; `GET /staff/orders/{id}/label` is deleted
  with a comment at the deletion point naming where it went, and its module docstring corrected so
  the module no longer advertises a door it does not have.
- The replacement label read keeps the removed door's CONTRACT key for key (carrier,
  tracking_number, barcode, dispatched_at, currency, declared_value_cents, ship_to) so the deletion
  is a redirect for its callers rather than a migration - and it reads the `shipments` row instead of
  the `orders.carrier`/`tracking_number` mirror, which was the actual defect.
- The merged `/carriers` response keeps ONE path for one question: the rail's performance stats under
  `carriers` and the label readiness under `label_readiness`, rather than a fourth route.
- Helpers moved rather than copied (`_recipient`, `_lines`, `_order_columns`), and the fulfilment
  document reuses the rail's existing `_shipment_payload`, so one parcel cannot be described two ways.
- Item 3 is enforced by the database, not by convention: `0020_shipping_single_owner` refuses a row
  moving into `shipped` or `delivered` without a `shipments` row in the SAME transaction, which is
  exactly the sequence the rail performs. No column was added, changed or dropped.
