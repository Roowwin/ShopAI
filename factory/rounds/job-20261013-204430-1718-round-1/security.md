VERDICT: PASS

Fast-lane landing (owner directive). What was actually checked, stated plainly:

- The recipient address is PII and is returned by exactly three routes, all gated
  `require_roles("admin","manager","warehouse")` AND carrying the in-body `_require_role` twin,
  because `staff_ai.chat` dispatches into routers as plain calls where `Depends` never evaluates.
  No other route in the codebase gained an address: `staff_views.get_order` still omits them.
- The queue is bounded (`limit` capped at 100) and one request loads every order's lines in ONE
  query, so the address cannot be enumerated in bulk and the endpoint is not an N+1.
- The test proves the wall three ways per route: 401 with no credential, 403 for a real `sales`
  token, 200 for `warehouse`.
- **No secret is ever returned.** The carrier credential is read from the settings store
  (`read_setting`, read-only) and the environment; it goes only into the outgoing `AUTH-KEY` header.
  The label response carries the label document and a tracking reference, never a credential.
- **The refusal is proved, not asserted.** With both credential sources emptied, the suite requires
  a 409, requires `AUSPOST_API_KEY` to be named in the message, and then asserts FROM THE DATABASE
  that no `shipments` row and no `label_booked` audit row were written - so an unconfigured carrier
  cannot leave a phantom parcel behind.
- **No customer data leaves the premises.** The client is inert: there is no account and no key, and
  the only test that exercises the request path uses a recording transport inside the process. No
  test and no code path sends a real address anywhere. This is stated in the test's own docstring so
  a later reader cannot mistake it for a live-call test.
- The one refusal about a real ORDER (labelling something not paid) IS audited - an act against an
  order is worth a record; a configuration gap is not, or the trail fills with setup mistakes.
- Booking a label writes nothing to `shipments`: recording the parcel remains the sibling's single
  write, behind its own row lock, so this job cannot create a second parcel for one order.
