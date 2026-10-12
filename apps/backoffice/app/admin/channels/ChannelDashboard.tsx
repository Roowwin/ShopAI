"use client";

import { useEffect, useState } from "react";
import { API } from "@/lib/api";
import { Badge, Card, Heading, cn } from "@/app/components/ui";
import { kickerClass } from "@/lib/ui";
import SamplePreview from "./SamplePreview";
import { CHANNELS, type ChannelId } from "./channels";

/* A marketplace hub page - the shape the brief asks for, drawn from the state this build is
   actually in.

   THE STATE THIS BUILD IS IN: there is no marketplace integration. Nothing under apps/backend/app
   names eBay, Amazon, a marketplace or a channel, so there are no credentials to hold, no channel
   for a listing to belong to, no per-product channel state and no sync job to run. A page that
   said "Connected", put a number beside "items live" and stamped a time under "last synced" would
   be inventing all three, and this is the page a visitor is most likely to believe.

   So the page reads in this order: the connection, then the destinations, then the control that
   would push to them - all three stating the true position - and the invented dashboard is last,
   behind a control the reader has to press, wearing a label that says what it is. Nothing true is
   dressed up and nothing invented is dressed as true.

   THE ONE REAL FIGURE is the storefront's listing count, and it is real because the shop really is
   selling: it is read from GET /store/catalog, the public endpoint the storefront itself lists
   from, and it is labelled with where it came from. It is deliberately the only reading on the
   page, and it is kept out of the sample panel above it.

   NO ROLE WALL IS ADDED. The only request this page makes is to a public endpoint, and no page in
   this app is behind a wall of its own beyond the ones the API already enforces. */

/* A connection state has no token set of its own - the asset lifecycle's tones describe what
   happened to a unit, and borrowing one would say "returned" about a channel. The neutral pair is
   the one lib/ui.ts already gives an unknown status, so nothing here invents a colour. */
const CHIP_IDLE = "bg-surface-sunken text-ink-600";
/* Live is the one state that matches an existing tone exactly: `listed` is what this app calls
   stock that is on the storefront. */
const CHIP_LIVE = "bg-status-listed-soft text-status-listed-ink";

const NO_INTEGRATION = "No marketplace integration is wired into this build.";

/* A two-state control needs its pressed state on the element, and the Button primitive carries no
   such attribute - so this is a plain button, exactly as the narrow-width drawer's own toggle is
   in layout.tsx, and its hairline is the one the secondary variant draws. */
const TOGGLE_BASE =
  "inline-flex min-h-[36px] items-center gap-2 rounded-control px-4 text-sm font-semibold ring-1 " +
  "transition-colors duration-fast ease-out motion-reduce:transition-none " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500";
const TOGGLE_OFF = "bg-surface text-brand-300 ring-line hover:bg-brand-50";
const TOGGLE_ON = "bg-brand-50 text-brand-300 ring-brand-100";

/* The storefront read has three ends and all three are drawn: it is in flight, it answered, or it
   did not. There is no fourth state and no fallback figure - a page that quietly showed yesterday's
   count would be the same lie as inventing one. */
type Catalogue =
  | { state: "reading" }
  | { state: "read"; count: number; capped: boolean }
  | { state: "unread" };

export default function ChannelDashboard({ channelId }: { channelId: ChannelId }) {
  /* The descriptor is looked up HERE rather than handed over as a prop, and that is not a style
     choice: a client component's props are serialised into the payload that ships inside the page,
     so passing the whole descriptor would put every invented figure into the markup of a page whose
     preview is off - the exact leak this page exists to avoid. An id serialises and nothing else
     does. `sample` therefore lives only in the bundle, behind the control that discloses it. */
  const channel = CHANNELS[channelId];
  const [preview, setPreview] = useState(false);
  const [catalogue, setCatalogue] = useState<Catalogue>({ state: "reading" });

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        /* Plain fetch rather than the shared apiFetch: this endpoint is public, and apiFetch sends
           a 401 anywhere else to the login page. A hub page must not bounce a reader who is not
           signed in when the one thing it reads needs no session at all. */
        const r = await fetch(API + "/store/catalog?limit=100", { credentials: "include", cache: "no-store" });
        if (!live) { return; }
        if (!r.ok) { setCatalogue({ state: "unread" }); return; }
        const body: unknown = await r.json();
        if (!live) { return; }
        if (!Array.isArray(body)) { setCatalogue({ state: "unread" }); return; }
        /* The endpoint takes at most 100 in one read, so a full page cannot be told from a shop
           with more than 100 listed products - and the page says "100 or more" rather than
           reporting the cap as the count. */
        setCatalogue({ state: "read", count: body.length, capped: body.length >= 100 });
      } catch {
        if (live) { setCatalogue({ state: "unread" }); }
      }
    })();
    return () => { live = false; };
  }, []);

  const storefrontState =
    catalogue.state === "read" ? "Live"
    : catalogue.state === "reading" ? "Reading"
    : "Not read";

  const storefrontDetail =
    catalogue.state === "read"
      ? (catalogue.capped
        ? "At least 100 products are listed on the storefront. The read stops at 100, so this page "
          + "does not know the exact number and does not guess one."
        : catalogue.count + (catalogue.count === 1 ? " product is" : " products are")
          + " listed on the storefront right now.")
        + " Read from the storefront catalogue (GET /store/catalog) when this page loaded."
      : catalogue.state === "reading"
        ? "Asking the storefront catalogue how many products are listed."
        : "The storefront catalogue could not be read just now, so this build cannot say how many "
          + "products are live. Nothing here fills that gap in.";

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 pt-8 pb-16">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Heading level="h1">{channel.heading}</Heading>
          <p className="mt-1 max-w-2xl text-sm text-ink-500">{channel.blurb}</p>
        </div>
        <button
          type="button"
          aria-pressed={preview}
          onClick={() => setPreview((v) => !v)}
          className={cn(TOGGLE_BASE, preview ? TOGGLE_ON : TOGGLE_OFF)}
        >
          {preview ? "Hide the sample preview" : "Preview the connected state (sample data)"}
        </button>
      </header>

      <Card className="p-6">
        <div className="flex flex-wrap items-center gap-3">
          <Heading level="h3" as="h2">Connection</Heading>
          <Badge colorClass={CHIP_IDLE}>Not connected</Badge>
        </div>
        <p className="mt-2 max-w-3xl text-sm text-ink-600">
          This build has no {channel.label} integration at all. There are no {channel.label}
          {" "}credentials to use, no channel on a product for a listing to belong to, and no sync
          job anywhere in the API. Nothing on this page is read from {channel.label}, and nothing on
          it is sent anywhere.
        </p>
        <p className={cn(kickerClass, "mt-4")}>What a connection would need</p>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-ink-500">
          {channel.needs.map((n) => (<li key={n}>{n}</li>))}
        </ul>
      </Card>

      {/* The cross-platform view, in the state it is really in: one destination the shop can reach
          and three it cannot. The storefront row is a reading; the other three are the absence of
          one, which is why they carry a note rather than a figure. */}
      <Card className="p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <Heading level="h3" as="h2">Destinations</Heading>
          <span className="text-xs text-ink-500">where this shop can sell right now</span>
        </div>
        <ul className="mt-3 divide-y divide-line">
          <li className="py-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="min-w-0 flex-1 text-sm font-semibold text-ink-900">Storefront (this shop)</span>
              <Badge colorClass={catalogue.state === "read" ? CHIP_LIVE : CHIP_IDLE}>{storefrontState}</Badge>
            </div>
            <p className="mt-1 text-xs text-ink-500">{storefrontDetail}</p>
          </li>
          {Object.values(CHANNELS).map((c) => (
            <li key={c.id} className="py-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="min-w-0 flex-1 text-sm font-semibold text-ink-900">{c.label}</span>
                <Badge colorClass={CHIP_IDLE}>Not connected</Badge>
              </div>
              <p className="mt-1 text-xs text-ink-500">{NO_INTEGRATION}</p>
            </li>
          ))}
        </ul>
      </Card>

      {/* THE CONTROL THAT IS NOT DRAWN. A press here would have nowhere to go: there are no
          credentials and no channel on a product, so there is nothing to push and no destination to
          push it to. A control that glowed and did nothing when pressed is the worst thing this
          page could ship, so this is a named absence instead of a disabled button - a disabled
          control still asks to be pressed, and this one has no state to be in. */}
      <Card className="p-6">
        <div className="flex flex-wrap items-center gap-3">
          <Heading level="h3" as="h2">Push to all marketplaces</Heading>
          <Badge colorClass={CHIP_IDLE}>Not available</Badge>
        </div>
        <p className="mt-2 max-w-3xl text-sm text-ink-600">
          There is no such control on this page, and this note is the whole of it. Pushing stock to
          a marketplace needs credentials this build does not hold and a channel on a product that
          does not exist, so a press would have no destination and no effect. When those exist, this
          note is where the control goes: one press, every connected marketplace.
        </p>
      </Card>

      {preview && <SamplePreview channel={channel} />}
    </main>
  );
}
