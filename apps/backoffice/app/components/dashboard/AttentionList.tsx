import { Badge, Card, Heading } from "@/app/components/ui";

/* The "needs attention" block: the four things worth a human's eyes, in the API's own order.

   The list is fixed (one row per kind, even at zero) rather than filtered to the non-empty ones:
   a dashboard that hides a counter the moment it reads 0 cannot show that the counter is watched
   - and "in repair > 14 days: 0" is a fact worth seeing, not noise to omit.
   The kind tones are a small token pair, not lib/ui's statusTone/gradeTone: those map the ASSET
   lifecycle, and a restock or a stale repair is not an asset status - reusing them would paint
   an operation with a state's colour. */
type Item = { id: number; title: string };
type Attention = { kind: string; count: number; label: string; items?: Item[] };

type Props = { items: Attention[] };

const COUNTED = "bg-accent-100 text-accent-700";
const CLEAR = "bg-surface-sunken text-ink-600";

export default function AttentionList({ items }: Props) {
  return (
    <Card className="p-4">
      <Heading level="h3" as="h2" className="mb-2">Needs attention</Heading>
      <ul>
        {items.map((a) => (
          <li key={a.kind} className="border-t border-line first:border-t-0 py-2.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm text-ink-900">{a.label}</span>
              <Badge colorClass={a.count > 0 ? COUNTED : CLEAR}>{a.count}</Badge>
            </div>
            {a.items && a.items.length > 0 && (
              <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-500">
                {a.items.map((p) => (
                  <li key={p.id}>{p.title}</li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
