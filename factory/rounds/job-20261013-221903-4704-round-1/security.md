VERDICT: PASS

Fast-lane landing (owner directive). Checked, and stated as such:

- **The door's role rule is unchanged and still admin-only.** Every new route inherits
  `ROLES_FINANCE_READ`/`ROLES_FINANCE_WRITE` and the in-body `_require_role` twin; the new PATCH is
  covered by a test that asserts 401 with no credential and 403 for a real `manager` token, so the
  console's new write cannot be the one that leaks the books to a role that may not read them.
- **The invoice document widens what ONE read returns, and it is the same wall.** Customer name,
  email and delivery address now come back from `GET /invoices/{id}` - admin-only, one invoice at a
  time, and the LIST deliberately still carries none of it. That is the PII-shaped change in this
  job and it is the reason the document is a separate read rather than fields on the page shape.
- **A correction cannot erase a record.** `PATCH` writes only the fields sent, validates what it is
  given (blank category 422, negative amount 422, missing row 404), and writes an audit row carrying
  the BEFORE and AFTER. There is no DELETE, by design.
- **Money units are converted once, in one function per page**, and a blank field is null rather than
  zero - so an untouched amount box cannot become a silent filter of `>= $0`.
- The new filters are parameterised casts, not string-built SQL; the only interpolation into a query
  is a `%`-wrapped needle passed as a bound parameter.
