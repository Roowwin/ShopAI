import { Badge, Heading, Stat, cn } from "@/app/components/ui";
import { kickerClass } from "@/lib/ui";
import type { Channel } from "./channels";

/* The connected state, drawn as a picture.

   EVERY FIGURE IN HERE IS INVENTED, and this panel says so three times over: in its heading, in
   the badge beside it, in the sentence under it, and again on every tile's own sub-line. That
   repetition is deliberate rather than sloppy - a screenshot of one tile should still carry the
   word that stops it being read as telemetry.

   The panel is drawn ONLY while the preview is on (see ChannelDashboard), so the page in its
   default state holds no invented figure at all - not on screen, and not in the markup a browser
   receives. The amber band is the app's own raised-on-muted step plus its attention hairline, which
   is how this panel reads as a different KIND of thing from the cards above it rather than as one
   more report. */

export default function SamplePreview({ channel }: { channel: Channel }) {
  return (
    <section aria-label="Sample data preview" className="rounded-card bg-surface-muted p-6 ring-1 ring-accent-400">
      <div className="flex flex-wrap items-center gap-3">
        <Heading level="h3" as="h2">Preview: the connected state</Heading>
        <Badge colorClass="bg-accent-100 text-accent-700">Sample data</Badge>
      </div>

      <p className="mt-2 max-w-3xl text-sm text-accent-700">
        Every figure in this panel is invented, and none of it updates. It is the shape a connected
        {" "}{channel.label} hub would take, drawn so the design can be looked at - nothing here was
        read from {channel.label} or from any other system.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {channel.sample.tiles.map((t) => (
          <Stat key={t.label} label={t.label} value={t.value} sub="sample figure" />
        ))}
      </div>

      <div className="mt-5">
        <p className={cn(kickerClass, "mb-1")}>Marketplace coverage</p>
        <ul className="divide-y divide-line">
          {channel.sample.rows.map((r) => (
            <li key={r.name} className="flex flex-wrap items-center gap-3 py-2">
              <span className="min-w-0 flex-1 text-sm text-ink-900">{r.name}</span>
              <Badge colorClass="bg-accent-100 text-accent-700">{r.state}</Badge>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-ink-500">
          Three sample rows, for the three marketplaces. The storefront&rsquo;s own row is the real
          one and sits above, outside this panel - it is the only destination this build can reach.
        </p>
      </div>

      <p className="mt-4 text-xs text-ink-500">
        The push control is not drawn in here either. See &ldquo;Push to all marketplaces&rdquo;
        above for why.
      </p>
    </section>
  );
}
