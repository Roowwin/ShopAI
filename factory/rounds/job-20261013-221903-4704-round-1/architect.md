VERDICT: PASS

Fast-lane landing (owner directive: gates then ship). Recorded honestly.

- The rail already existed and was NOT rebuilt: `staff_finance.py`, `services/ledger.py`, 0019's
  `invoices`/`expenses` tables and `test_finance_ledger.py` are a sibling's work, and this job adds
  only what the console needed. Three API deltas, not a parallel implementation.
- The three deltas are minimal and where they belong: the register's customer/amount filters, the
  invoice DOCUMENT (customer, address, lines) as a second read rather than fields bolted onto the
  list shape, and a partial `PATCH` for expenses.
- The console is five pages that all read the API's own numbers. The P&L page draws bars from the
  payload and computes nothing; the hub asks the same endpoint the report does, so the headline and
  the statement behind the link cannot disagree.
- The sidebar's Financials became a parent with three children, using the nesting the previous job
  built - one data change plus one `soon` flag removed, no new component work.
- Deliberate omissions, all recorded in the code: no DELETE for an expense (a corrected row with a
  trail is the honest fix for a wrong one), no invoice creation on the register (the payment path
  issues them), and no invented seller identity on the tax invoice.
