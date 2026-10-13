VERDICT: PASS

Fast-lane landing (owner directive: gates then ship, no review rounds). Recorded honestly.

- Scoped against the sibling's in-flight logistics job at design time, not at merge time: that
  session owns `shipments`, `staff_logistics.py` and the mark-shipped write, so this job adds only
  what had no home - the fulfilment queue and the carrier call - and consumes the rest.
  `services/carriers.py` and `api/v1/staff_shipping.py` are new files; the only existing file edited
  for the backend is `main.py`'s import list and one `include_router`.
- `services/carriers.py` is a real client behind a carrier interface with ONE implementation, so a
  second carrier is an entry in `CARRIERS` plus one function. `book_label` takes the httpx client as
  a parameter - the single seam that lets request shaping be asserted against a recording transport
  with no account and no network.
- The carrier is INERT and says so: `available()` names what is missing, `book_label` raises rather
  than inventing a label or a tracking number, and the API turns that into a 409 with the list.
- Nav and merge conflicts resolved in favour of both sides - Pick & Pack and Logistics both sit under
  Commerce, ordered the way an operator lives them, and BOTH routers are registered.
- Reuses the house primitives and idioms throughout (`useMe`/`requireRole`, `apiFetch`, the
  `{detail}` error shape, Table/Stat/Select/Badge, `lib/ui` tones, `lib/format` formatters), and the
  new pages print with print-scoped CSS and no new dependency - including no hand-rolled barcode,
  which is a deliberate omission argued in the documents page.
