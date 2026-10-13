VERDICT: PASS

Fast-lane landing (owner directive). What was checked:

- **The role wall did not narrow or widen.** The moved routes carry the rail's own `ROLES_SHIP` and
  its in-body `_require_role` twin, replacing the two duplicate tuples (`LABEL_ROLES` in
  `staff_orders`, the tuple in the deleted `staff_shipping`). The suite still proves 401 with no
  credential and 403 for a real `sales` token on every moved route.
- **The recipient address remains PII with the same walls it had.** It is returned by the queue, the
  fulfilment document and the label read - all `admin`/`manager`/`warehouse` - and the queue is still
  bounded (limit capped at 100) so no single request enumerates the customer base's addresses.
- **The new database rule cannot be used to hide a write.** The trigger raises with `ERRCODE =
  check_violation` and the test asserts the refused UPDATE did not land (`orders.status` is still
  `paid` afterwards), so a refused transition is a refusal rather than a silent no-op.
- **No secret is exposed by the move.** The carrier credential still goes only into the outgoing
  `AUTH-KEY` header; `label_readiness` reports whether a carrier is configured and what is missing,
  never a key. The unconfigured-carrier test still proves, from the database, that no `shipments` row
  and no `label_booked` audit row are written on a refusal.
- **Nothing outward-facing changed**: the carrier client is still inert, and the only path that
  exercises a request uses an in-process recording transport.
- The audit trail survives the move with its action names intact (`book_label` / `read_label`), so a
  booking does not look like a different act because the path changed.
