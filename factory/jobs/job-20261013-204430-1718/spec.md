# The Fulfillment Workbench: paid-order queue, Pick & Pack, carrier labels

## Context

Read docs/PROJECT_CONTEXT.md standing rules. A SIBLING SESSION owns the logistics foundation and is
mid-build on it in the main tree - `0018_logistics.py` (shipments/payouts/payout_matches),
`services/logistics.py`, `api/v1/staff_logistics.py`. **Do not duplicate, re-implement or edit any
of it.** Its `POST /staff/logistics/orders/{order_id}/ship` is the "mark as Shipped" write this job
CONSUMES; its `GET /staff/logistics/alerts` is the alerting view. Owner's scoping decision: this job
delivers the UI and the documents, plus one genuinely new backend surface - the carrier client.

Two gaps this job exists to close:

1. **The recipient address is exposed NOWHERE.** `orders.ship_to_name / ship_line1 / ship_line2 /
   ship_city / ship_state / ship_postcode / shipping_country` are captured at checkout
   (`store_ops.checkout`) and read by no staff route at all - `staff_views.get_order` omits them on
   purpose, with the comment "Add them only with a reason, never by default". A shipping label and a
   packing slip ARE that reason. PII rules: the address is returned only through this job's
   warehouse-gated routes, and never on a list that a broader role can read.
2. **There is no carrier client and no credential.** `carrier` is free text on a shipment. Owner's
   decision: build a REAL Australia Post client behind a carrier interface, one carrier first,
   **inert until keyed** - it must refuse with a clear, actionable message when unconfigured and
   must NEVER emit a fabricated label or tracking number.

## Deliverable

### A. `apps/backend/app/services/carriers.py` (new; no existing file is edited)
* A carrier registry with ONE reference implementation (Australia Post) behind it, so a second
  carrier is an addition rather than a rewrite: a name, a label, what it needs configured, and the
  function that books a label.
* `CarrierError` for every refusal. `credentials(db, provider)` resolves a credential from the
  platform's settings store FIRST (read-only: `services.system_settings.read_setting` +
  `API_KEYS_KEY`; the stored `secret` is plaintext there, masked only for HTTP reads) and falls back
  to the environment (`AUSPOST_API_KEY`, `AUSPOST_ACCOUNT`). Absent both, the carrier is
  UNCONFIGURED.
* `available(db)` - per carrier: configured or not, and the exact thing that is missing. This is
  what the UI prints instead of a button that cannot work.
* `book_label(db, *, carrier, order, recipient, sender, parcel)` -> a dataclass carrying
  `carrier`, `service`, `tracking_ref`, `label_bytes`, `label_format`, `cost_cents`, `raw`.
  * Australia Post: build the documented shipment JSON, POST it to the Shipping API with the
    `AUTH-KEY` header and the account number in the `from` block, read the article id back, then GET
    the label document for that shipment id and return its bytes.
  * THE HTTP IS ONE SMALL SEAM. `_post_json` / `_get_bytes` take the client, so the whole thing can
    be exercised against an offline transport with no network and no account.
  * Endpoint and auth come from configuration (`AUSPOST_API_BASE`, defaulting to the documented
    production host); a test environment is a base-URL change, not a code change.

### B. `apps/backend/app/api/v1/staff_shipping.py` (new router, `/staff/shipping`, tags `staff-shipping`)
Register in `app/main.py` (the one line that will conflict at merge - keep BOTH routers when it does).
Roles `("admin", "manager", "warehouse")`, matching the sibling's shipping roles, plus an in-body
`_require_role` because `staff_ai.chat` dispatches into routers as plain calls.
* `GET /staff/shipping/queue` - orders that are `paid` with no shipment row, oldest first, each with
  its recipient address, its lines and its totals. THIS is the packing-slip source and the Pick &
  Pack queue. Bound the page; report the total.
* `GET /staff/shipping/orders/{order_id}` - one order's full fulfilment document: address, lines
  (sku_title, grade, serial tail), totals, customer, and the shipment if one exists.
* `GET /staff/shipping/carriers` - `available()`'s answer, so the screen can say WHY a carrier is
  unusable rather than failing on press.
* `POST /staff/shipping/orders/{order_id}/label` - book a label. 409 with the missing configuration
  named when the carrier is unconfigured; 409 when the order is not `paid`; audits every attempt
  that reaches the carrier, and every refusal that is about the ORDER (not about configuration).
  Returns the label bytes base64 plus the tracking ref. **It does NOT write the shipment row** -
  recording the parcel stays the sibling's `POST /staff/logistics/orders/{id}/ship`; this job returns
  the label and the tracking ref for the operator to confirm there.

### C. `apps/backend/tests/test_fulfillment.py` (new)
Against the live DB, the `client` + `bootstrap` idiom, with a `finally` cleanup that deletes ONLY
the addresses this file minted (`pytest-ful-...`, not a blanket `pytest-%` sweep - a concurrent
suite's teardown deletes those mid-test and turns a green run red). Prove:
* the queue lists a paid, unshipped order WITH its address, and does NOT list a shipped one, a
  delivered one, or an unpaid one;
* the three routes are 401 with no credential, 403 for a `sales` staff token, 200 for `warehouse`;
* an unconfigured carrier returns 409 naming what is missing - AND that it produced no label, no
  tracking ref, and wrote no shipment row;
* with `AUSPOST_API_KEY`/`AUSPOST_ACCOUNT` monkeypatched AND the HTTP transport replaced by a
  recording double: the request built is the documented one (method, host, path, `AUTH-KEY` header,
  account number and recipient in the JSON body), and the response is parsed into a tracking ref and
  label bytes. This is a request-shaping proof, NOT a live call - say so in the test's docstring.

### D. Backoffice
* `app/admin/shipping/page.tsx` (new) - **Pick & Pack**. The queue as a worklist: per order, the
  pick list (lines with grade + serial tail), the recipient block, the totals, a carrier picker that
  shows each carrier's readiness, a "Get label" action, and a "Mark shipped" action that calls the
  sibling's `POST /staff/logistics/orders/{id}/ship`. The label's tracking ref prefills the ship
  call, so booking and recording are one flow. Says plainly, in the UI, that the carrier is
  unconfigured when it is.
* `app/admin/orders/[id]/documents/page.tsx` (new) - **the printable documents**: a packing slip and
  a shipping label, each on its own print page with `@media print` rules, page size, monochrome-safe
  ink, and a scannable barcode drawn from the tracking reference (inline SVG, no dependency). A
  "Print" control and a "Download label PDF" control when the carrier returned one.
* `app/admin/orders/page.tsx` - add the fulfilment signal the mission asks for: a count of orders
  awaiting fulfilment with a link into Pick & Pack, and an "awaiting fulfilment" filter that reaches
  the queue. Do not restructure the existing browser.
* `app/components/nav.ts` - add `/admin/shipping` ("Pick & Pack") to the Inventory & Logistics group.

## Acceptance
* Gate: `docker compose run --rm api pytest -q` with the accepted deselects, BEFORE and AFTER
  counts, NO NEW FAILURES. Run it with THIS tree mounted over the baked image
  (`-v "$(pwd -W)/apps/backend:/app"`), because a sibling session rebuilds the shared `rfo-api` tag
  from its own tree and an unmounted run then tests THEIR code.
* `npx tsc --noEmit && npx next build` exit 0, with the new routes in the route list. Report the exit
  code from a NON-piped run.
* The live route check: the served Pick & Pack page and its chunk carry the new UI's own copy.
* Name which tree the api image was built from.
* Every claim backed by a command and its output, not by inspection.

## Constraints
- Work only on branch `factory/<job-id>` (git worktree provided).
- DO NOT EDIT: `services/logistics.py`, `api/v1/staff_logistics.py`, `alembic/versions/0018_logistics.py`
  or any existing migration - the sibling owns them. `app/main.py` gets ONE added import + ONE added
  `include_router` and nothing else.
- Reuse `services/system_settings.read_setting` read-only. Do not edit it, and never return a secret
  over HTTP.
- LF / no BOM. No new dependency, frontend or backend (the barcode is inline SVG; httpx is present).
- Never fabricate a label, a tracking number or a rate. Unconfigured means refused, out loud.
- The address is PII: it appears only on these warehouse-gated routes and the two new pages.
