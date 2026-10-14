import { INTERNAL } from "@/lib/api";
import { Badge, Button, Card, Heading, linkClass } from "../../components/ui";

/* THE PUBLIC TRACKING RESULT.
 *
 * Server-rendered and needing no credential: it reads the API over the internal network the same
 * way the catalog pages do, so the page works for a stranger who was handed a tracking number and
 * has never signed in.
 *
 * WHAT IT MAY SAY IS THE API'S DECISION, NOT THIS PAGE'S. `GET /store/track/{ref}` returns the
 * parcel's movement - carrier, service, dates - and deliberately nothing about the order's contents,
 * totals or destination, because a carrier reference is far more guessable than the UUID that opens
 * a confirmation page. This component renders that payload and adds no inference of its own; the
 * "items and totals live behind your order link" line below is the page being honest about the
 * boundary rather than an accident of what happened to be in the JSON.
 *
 * It fetches with plain `fetch` instead of `apiInternal` so the API's own sentence survives: a
 * mistyped reference is a 404 reading "no parcel matches that tracking reference", and a reference
 * two carriers happen to share is a 409 naming them. `apiInternal` collapses both into a thrown
 * "upstream 404/409", which is exactly the case the person in front of this page needs explained.
 */

export const revalidate = 0;

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-AU") : null);

export default async function TrackResultPage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  let parcel: any = null;
  let failure: string | null = null;

  try {
    const r = await fetch(INTERNAL + "/store/track/" + encodeURIComponent(ref), { cache: "no-store" });
    if (r.ok) {
      parcel = await r.json();
    } else {
      const j: any = await r.json().catch(() => ({}));
      failure = typeof j?.detail === "string" ? j.detail : "we could not look that reference up";
    }
  } catch {
    failure = "we could not reach the shop just now";
  }

  if (parcel === null) {
    return (
      <main className="max-w-lg mx-auto px-4 pt-20 pb-28 text-center">
        <Heading level="h1">Nothing to show</Heading>
        <p className="text-sm text-ink-600 mt-3" role="alert">{failure}</p>
        <p className="text-xs text-ink-400 mt-2">
          Reference: <span className="font-mono">{ref}</span>
        </p>
        <div className="mt-6 flex gap-3 justify-center">
          <Button href="/track">Try another number</Button>
          <Button variant="secondary" href="/account">My orders</Button>
        </div>
      </main>
    );
  }

  const delivered = parcel.status === "delivered";
  const steps = [
    { label: "Dispatched", at: parcel.dispatched_at, done: true },
    { label: "Delivered", at: parcel.delivered_at, done: delivered },
  ];

  return (
    <main className="max-w-lg mx-auto px-4 pt-20 pb-28">
      <Card className={"p-5 md:p-6 " + (delivered ? "bg-brand-500/15 text-brand-300" : "bg-surface-sunken text-ink-700")}>
        <div role="status">
          <Heading level="h1" className="!text-current">
            {delivered ? "Delivered" : "On its way"}
          </Heading>
          <p className="text-sm mt-2">
            {delivered
              ? "This parcel has been delivered. Thanks for keeping a device out of landfill."
              : parcel.promised_at
                ? "This parcel is with " + parcel.carrier + ", expected by " + fmt(parcel.promised_at) + "."
                : "This parcel is with " + parcel.carrier + "."}
          </p>
        </div>
      </Card>

      <ol className="mt-6 flex items-center gap-2" aria-label="Parcel progress">
        {steps.map((s) => (
          <li key={s.label} className="flex-1">
            <div className={"h-1.5 rounded-full " + (s.done ? "bg-ink-700" : "bg-surface-sunken")} />
            <p className={"mt-1.5 text-eyebrow " + (s.done ? "font-semibold text-ink-900" : "text-ink-500")}>
              {s.label}
            </p>
          </li>
        ))}
      </ol>

      <Card className="p-5 md:p-6 mt-6">
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-ink-500">Carrier</dt>
            <dd className="text-right">{parcel.carrier}{parcel.service ? " - " + parcel.service : ""}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink-500">Tracking number</dt>
            <dd className="text-right font-mono">{parcel.tracking_ref}</dd>
          </div>
          {(parcel.dispatched_at || parcel.delivered_at) && (
            <div className="flex justify-between gap-4">
              <dt className="text-ink-500">{delivered ? "Delivered" : "Dispatched"}</dt>
              <dd className="text-right">{fmt(delivered ? parcel.delivered_at : parcel.dispatched_at)}</dd>
            </div>
          )}
          <div className="flex justify-between gap-4 items-center">
            <dt className="text-ink-500">Order status</dt>
            <dd className="text-right">
              <Badge colorClass="bg-surface-sunken text-ink-600">{parcel.order_status}</Badge>
            </dd>
          </div>
        </dl>
        <p className="mt-4 text-xs text-ink-400">
          This page shows where your parcel has got to. The items, totals and delivery address on
          this order are on that order&apos;s own confirmation link, or under{" "}
          <a href="/account" className={linkClass}>your orders</a>.
        </p>
      </Card>

      <div className="mt-6 flex gap-3">
        <Button variant="secondary" href="/track">Track another</Button>
        <a href="/returns" className={"self-center text-sm " + linkClass}>Returns policy</a>
      </div>
    </main>
  );
}
