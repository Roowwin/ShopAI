/* The dashboard charts - hand-rolled SVG. No chart library, no new dependency: the shapes here
   are a ring of arcs, four rounded bars and one stacked bar, and a charting package would be a new
   runtime dependency and a new build step for those. J2 wrote this file beside /admin/dashboard;
   J7's /admin draws the same donut and the same grade palette, so the file moved into the shared
   dashboard set and both pages import it - one chart module, not two.

   The palette is not invented here. Every mark takes its fill from the design system's own CSS
   custom properties (app/globals.css), so a donut slice IS the status colour its badge chip
   already uses and a bar IS its grade colour - one palette, one meaning. They are consumed as
   `rgb(var(--status-listed-solid))` rather than a Tailwind `fill-*` utility on purpose: the
   tokens are raw channel triples on :root, so an SVG attribute reads them directly and no class
   has to survive the Tailwind scanner for the chart to paint.

   Identity is never carried by colour alone: the donut ships a legend (label + count), each bar is
   directly labelled with its grade and its value, the stacked bar's legend names every grade
   including the ones at zero, and every mark carries a <title> so a hover reports the exact figure
   without a JS tooltip layer.

   `total` is passed in rather than summed here so the ring and its legend cannot disagree with
   the KPI tiles above them: the page takes both from the same payload read. The stacked bar's
   whole is the one figure this module sums itself, and it says so at the call site. */

export type Slice = { key: string; label: string; value: number };

const TAU = Math.PI * 2;
const R = 62;              // ring radius (centre of the band)
const C = TAU * R;         // circumference, the length every dash pattern is measured against
const RING = 26;           // band thickness

/* The status token name for a lifecycle key: `in_repair` -> `in-repair`, because the CSS
   custom properties spell it with a hyphen while the API (and its CHECK constraint) spell it
   with an underscore. Every other status is a single word and passes through unchanged. */
function statusToken(key: string): string {
  return `rgb(var(--status-${key.replace(/_/g, "-")}-solid))`;
}

function gradeToken(grade: string): string {
  return `rgb(var(--grade-${grade.toLowerCase()}-solid))`;
}

function pct(part: number, whole: number): string {
  return whole > 0 ? ((part / whole) * 100).toFixed(0) + "%" : "0%";
}

export function StatusDonut({ slices, total, centerLabel }: { slices: Slice[]; total: number; centerLabel: string }) {
  const live = slices.filter((s) => s.value > 0);
  let cum = 0;
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
      <svg viewBox="0 0 180 180" className="h-40 w-40 shrink-0" role="img"
           aria-label={`${centerLabel}: ${total}, by status`}>
        {/* rotate(-90) starts the first slice at 12 o'clock instead of the circle path's 3
            o'clock, so the lifecycle reads clockwise from the top. */}
        <g transform="rotate(-90 90 90)">
          {total === 0 && (
            <circle cx="90" cy="90" r={R} fill="none" stroke="rgb(var(--surface-sunken))" strokeWidth={RING} />
          )}
          {live.map((s) => {
            const dash = (s.value / total) * C;
            const offset = -(cum / total) * C;
            cum += s.value;
            /* 2px of surface between neighbours - the dash is shortened and the pattern's own
               gap absorbs the difference, so no slice bleeds into the next. */
            const drawn = Math.max(dash - 2, 0);
            return (
              <circle key={s.key} cx="90" cy="90" r={R} fill="none"
                      stroke={statusToken(s.key)} strokeWidth={RING}
                      strokeDasharray={`${drawn} ${C - drawn}`} strokeDashoffset={offset}>
                <title>{`${s.label}: ${s.value} (${pct(s.value, total)})`}</title>
              </circle>
            );
          })}
        </g>
        <text x="90" y="87" textAnchor="middle" className="fill-ink-900" fontSize="26" fontWeight="600">{total}</text>
        <text x="90" y="105" textAnchor="middle" className="fill-ink-500" fontSize="10">{centerLabel}</text>
      </svg>
      {/* The legend is mandatory, not decoration: ten status hues are not separable by eye, so
          the label and the count beside each swatch are what actually carry identity.

          A FOCUSED legend, which is not the same as a filtered one. The ring already draws only
          the non-zero slices (`live`), so a row reading 0 is a line about something that is not in
          the picture - and ten of those interleaved with the four that matter is how a legend
          becomes a column of grey nobody reads. The zero rows are stepped back to 45% rather than
          dropped: the lifecycle is a fixed ladder, and a status that is empty today still has to
          be locatable in the list, which is the same reason the grade dropdown keeps its
          out-of-stock rungs. */}
      <ul className="min-w-[10rem] flex-1 space-y-1.5">
        {slices.map((s) => (
          <li key={s.key} className={"flex items-center gap-2.5 text-xs" + (s.value === 0 ? " opacity-45" : "")}>
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: statusToken(s.key) }} />
            <span className="truncate text-ink-600">{s.label}</span>
            <span className="ml-auto font-medium tabular-nums text-ink-900">{s.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function GradeBars({ bars }: { bars: Slice[] }) {
  const W = 320;
  const H = 190;
  const BASE = 156;   // the baseline every bar grows from
  const TOP = 26;     // the tallest bar's top - headroom for the value label above it
  const PAD = 10;
  const step = (W - PAD * 2) / Math.max(bars.length, 1);
  const barW = Math.min(48, step * 0.55);
  const max = Math.max(1, ...bars.map((b) => b.value));

  /* A 4px rounded data-end, anchored to the baseline. Written as a path rather than a
     `<rect rx>` because rx would round the BOTTOM corners too, lifting the bar off its own
     baseline - a bar must sit flat on the axis. A bar shorter than the radius falls back to a
     plain rectangle, since rounding it would eat the whole mark. */
  const barPath = (x: number, y: number, h: number): string => {
    const r = 4;
    if (h <= r) { return `M${x},${BASE} h${barW} v${-h} h${-barW} Z`; }
    return `M${x},${BASE} L${x},${y + r} Q${x},${y} ${x + r},${y} ` +
           `L${x + barW - r},${y} Q${x + barW},${y} ${x + barW},${y + r} L${x + barW},${BASE} Z`;
  };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-44 w-full" role="img" aria-label="Listed units by grade">
      {/* One recessive hairline as the axis; no gridlines - four bars do not need a lattice. */}
      <line x1={PAD} y1={BASE} x2={W - PAD} y2={BASE} stroke="rgb(var(--line))" strokeWidth="1" />
      {bars.map((b, i) => {
        const cx = PAD + step * (i + 0.5);
        const x = cx - barW / 2;
        const h = (b.value / max) * (BASE - TOP);
        const y = BASE - h;
        return (
          <g key={b.key}>
            <path d={barPath(x, y, h)} fill={gradeToken(b.key)}>
              <title>{`Grade ${b.label}: ${b.value} listed units`}</title>
            </path>
            {/* Text wears the ink tokens, never the series colour - the bar beside it carries
                the identity, the number stays legible. */}
            <text x={cx} y={y - 7} textAnchor="middle" className="fill-ink-600" fontSize="11">{b.value}</text>
            <text x={cx} y={BASE + 17} textAnchor="middle" className="fill-ink-500" fontSize="11" fontWeight="600">{b.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

/* Units by grade as ONE horizontal stacked bar, for /admin (J7).

   The dashboard's own GradeBars draws four separate pills, which answers "how many of each" but
   not "what is the mix". The brief asks for the stacked shape, so this composes the same grade
   palette into a single whole-width bar. It is a different component rather than a mode of
   GradeBars because the two draw different data and answer different questions: GradeBars draws
   `dashboard.grade_mix` (LISTED units only - the storefront-facing mix) while this draws
   `inventory.by_grade` (every unit that carries a grade - the same map /admin's breakdown table
   used to print). Both are real payload maps; the headings say which one is on screen.

   EVERY exact number survives the conversion. No segment carries text of its own, and the legend
   under the bar prints each grade's label and its count - including a grade at zero, which draws
   no segment and would otherwise vanish from the chart entirely. The whole-set figure is printed
   under the legend, and it is the ONE number on this page that is summed in the browser rather
   than read from the payload: `inventory.by_grade` has no total field, and a whole-width bar
   cannot be drawn without its whole. It is labelled as the sum it is, so it cannot be mistaken
   for a field the API sent. */
export function GradeStack({ segments }: { segments: Slice[] }) {
  const total = segments.reduce((n, s) => n + s.value, 0);
  const share = (v: number) => (total > 0 ? `${(v / total) * 100}%` : "0%");
  return (
    <div>
      {/* The bar is bounded by the app's own hairline rather than filled with a recessed tone: a
          fill that is nothing but a darker step of the card reads as no bar at all when the whole
          set is zero, and the hairline is the boundary every other panel on this surface uses. */}
      <div className="flex h-7 w-full gap-[2px] overflow-hidden rounded-full ring-1 ring-line" role="img"
           aria-label={`Units by grade: ${segments.map((s) => `grade ${s.label} ${s.value}`).join(", ")}; ${total} units carry a grade`}>
        {segments.filter((s) => s.value > 0).map((s) => (
          <span key={s.key} className="h-full" style={{ width: share(s.value), backgroundColor: gradeToken(s.key) }} />
        ))}
      </div>
      {/* The legend is mandatory, not decoration: identity and the exact count live here, because
          the segments themselves carry no text. */}
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {segments.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5 text-xs">
            <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: gradeToken(s.key) }} />
            <span className="text-ink-600">Grade {s.label}</span>
            <span className="tabular-nums text-ink-900">{s.value}</span>
          </li>
        ))}
      </ul>
      <p className="mt-1 text-xs text-ink-500">
        {total.toLocaleString("en-AU")} units carry a grade - the sum of the segments above, since
        the API reports no graded-units total of its own.
      </p>
    </div>
  );
}

/* The mini-sparkline the brief asks the Revenue and Inventory cards to carry.

   THE PAYLOAD HAS NO SERIES, and this is the one briefed element that needs backend data. GET
   /staff/overview reports `dashboard.revenue_last_7d_cents` and `stock_value.listed_units` as
   single figures; it carries no per-day revenue (or per-day anything), and nothing else in it is
   a time series - inventory.by_status, grade_mix, category_mix and orders.by_state are
   distributions, team_activity is per-actor, audit_feed is a capped list of events. So both pages
   pass `series={null}` - the dashboard for `dashboard.revenue_last_7d_cents`, /admin's pulse cards
   for `orders.revenue_paid_cents_30d` and `stock_value.at_list_cents` - and the card renders the
   explicit unavailable state below.

   The drawn branch is the shape the endpoint would have to carry - seven daily values - and it is
   deliberately NOT fed a made-up one: a plausible-looking trend line invented from a single
   7-day total is a fabricated fact on a page an operator makes stock decisions from, which is
   strictly worse than an honest gap. Nothing renders here that is not a number the API sent.

   The mark wears `--brand-500` (emerald) like the bars wear their grade colour, and the value is
   also in the aria-label and the <title>, so the trend is never colour-only. */

export function Sparkline({ series, label, unavailable }: {
  series: number[] | null;
  label: string;
  unavailable: string;
}) {
  const values = series && series.length >= 2 && series.every(Number.isFinite) ? series : null;
  if (!values) {
    return <p className="mt-2 text-xs text-ink-400">{unavailable}</p>;
  }
  const W = 120;
  const H = 28;
  const PAD = 2;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (i: number) => PAD + (i / (values.length - 1)) * (W - PAD * 2);
  const y = (v: number) => H - PAD - ((v - min) / span) * (H - PAD * 2);
  const line = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const last = values[values.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 h-7 w-full" role="img"
         aria-label={`${label}: ${values.length}-point trend, lowest ${min}, highest ${max}, latest ${last}`}>
      <path d={line} fill="none" stroke="rgb(var(--brand-500))" strokeWidth="1.5"
            strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={x(values.length - 1)} cy={y(last)} r="2" fill="rgb(var(--brand-300))" />
      <title>{`${label}: latest ${last}`}</title>
    </svg>
  );
}
