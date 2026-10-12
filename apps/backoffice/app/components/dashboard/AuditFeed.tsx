import type { ReactNode } from "react";
import { Badge, Card, Heading } from "@/app/components/ui";
import { when } from "@/lib/format";
import { MUTED_TONE } from "./tokens";

/* The recent-activity feed: the last 20 audit rows the API hands back, as a condensed icon feed.

   J7 restyled this from a four-cell table into a rail of glyph, action, entity and time. The rows
   are the payload's, unchanged, and this is still the ONE feed component - the asset detail page
   renders it too, rather than growing a second one.

   Read-only on purpose - there is no refund and no delete anywhere in this app, and the audit log
   is append-only at the DB level (0001_initial revokes UPDATE/DELETE on it), so a row here can
   never be an action affordance. The rows carry no links either: an entity_id is not a promise
   that the entity still exists, and a row that looks pressable but is not would be the same lie in
   a smaller size.

   The glyph is chosen by ENTITY, from the ten entity names this endpoint's own writers produce
   (agent, ai, asset, cms, lot, order, payment, product, promotion, reservation). It is
   deliberately not keyed on the twenty-four entity-and-action pairs that exist in the live audit
   log: a mark per action would be twenty-four invented symbols for one stream, and the action is
   already printed beside it. A name this map has not been taught takes the neutral glyph rather
   than throwing.

   The action is printed EXACTLY as the API sent it (scan_in, lot_activate, grant_revoked), not
   humanised here: this feed is the audit trail, and a rewritten action is a claim about the record
   rather than a copy of it.

   The actor is shown as its type plus id, as it was in the table: the API's actor_id is a
   staff_users.id, which is what the audit trail itself records - resolving it to an email would be
   a second query per row, the N+1 this endpoint exists to avoid.

   Every cell's CONTENT styling lives on an inner span, never on the row: there is no
   tailwind-merge in this app, so a colour class added to a shared element appends to the
   primitive's rather than replacing it. */

type Entry = { at: string; actor_type: string; actor_id: number | null; entity: string; action: string; entity_id: number | null };

type Props = { entries: Entry[] };

/* Hand-rolled at a 16-unit box, in the text colour of the chip they sit in, so the glyph inherits
   the ink that was audited for it instead of carrying a colour of its own. */
const GLYPH: Record<string, ReactNode> = {
  // a crate: one unit of stock
  asset: <path d="M2.5 4.5h11v8h-11zM2.5 7.5h11" />,
  // a box on a pallet: the units that arrived together
  lot: <path d="M2.5 11.5h11M4.5 11.5v2M11.5 11.5v2M5 4.5h6v6H5z" />,
  // a receipt: a placed order
  order: <path d="M3.5 2.5h9v11.5l-2.25-1.5-2.25 1.5-2.25-1.5-2.25 1.5zM6 5.5h4" />,
  // a card: a payment
  payment: <path d="M2.5 4.5h11v7h-11zM2.5 7.5h11" />,
  // a tag: a catalogue product
  product: <><path d="M9 2.5h4.5V7L8 12.5 3.5 8z" /><circle cx="10.8" cy="5.2" r="0.9" /></>,
  // a four-point spark: a promotion
  promotion: <path d="M8 2.5l1.5 4L13.5 8l-4 1.5L8 13.5l-1.5-4L2.5 8l4-1.5z" />,
  // a page with a header rule: the CMS
  cms: <path d="M3.5 2.5h9v11h-9zM3.5 5.5h9M5.5 8.5h5M5.5 11h3" />,
  // a hexagon: an agent grant
  agent: <><path d="M8 2.5l4.5 2.75v5.5L8 13.5l-4.5-2.75v-5.5z" /><circle cx="8" cy="8" r="1.4" /></>,
  // a chip with pins: the model
  ai: <path d="M5.5 5.5h5v5h-5zM3.5 7h2M3.5 9h2M10.5 7h2M10.5 9h2M7 3.5v2M9 3.5v2M7 10.5v2M9 10.5v2" />,
  // a clock: a hold on a unit
  reservation: <><circle cx="8" cy="8" r="5.5" /><path d="M8 5v3.2l2.1 1.3" /></>,
  // a name the map has not been taught
  other: <circle cx="8" cy="8" r="1.5" />,
};

export default function AuditFeed({ entries }: Props) {
  return (
    <Card className="p-4">
      <Heading level="h2">Recent activity</Heading>
      {entries.length === 0 ? (
        <p className="mt-2 text-sm text-ink-500">No audit activity yet.</p>
      ) : (
        <ul className="mt-1 divide-y divide-line">
          {entries.map((e, i) => (
            <li key={`${e.at}-${i}`} className="flex items-start gap-3 py-2">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-control bg-surface-sunken text-ink-500">
                <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4"
                     fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                  {GLYPH[e.entity] ?? GLYPH.other}
                </svg>
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-ink-900">{e.action}</p>
                <p className="text-xs text-ink-500">
                  <span className="font-mono">{e.entity}{e.entity_id != null ? ` #${e.entity_id}` : ""}</span>
                  <span aria-hidden="true"> &middot; </span>{when(e.at)}
                </p>
              </div>
              <Badge colorClass={MUTED_TONE} className="shrink-0">
                {e.actor_type}{e.actor_id != null ? ` · ${e.actor_id}` : ""}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
