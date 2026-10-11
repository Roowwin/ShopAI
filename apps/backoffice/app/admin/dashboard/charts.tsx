/* The dashboard's two charts - hand-rolled SVG. No chart library, no new dependency: the two
   shapes here are a ring of arcs and four rounded bars, and a charting package would be a new
   runtime dependency and a new build step for that.

   The palette is not invented here. Every mark takes its fill from the design system's own CSS
   custom properties (app/globals.css), so a donut slice IS the status colour its badge chip
   already uses and a bar IS its grade colour - one palette, one meaning. They are consumed as
   `rgb(var(--status-listed-solid))` rather than a Tailwind `fill-*` utility on purpose: the
   tokens are raw channel triples on :root, so an SVG attribute reads them directly and no class
   has to survive the Tailwind scanner for the chart to paint.

   Identity is never carried by colour alone: the donut ships a legend (label + count) and each
   bar is directly labelled with its grade and its value, and every mark carries a <title> so a
   hover reports the exact figure without a JS tooltip layer.

   `total` is passed in rather than summed here so the ring and its legend cannot disagree with
   the KPI tiles above them: the page takes both from the same payload read. */

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
          the label and the count beside each swatch are what actually carry identity. */}
      <ul className="min-w-[10rem] flex-1 space-y-1">
        {slices.map((s) => (
          <li key={s.key} className="flex items-center gap-2 text-xs">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: statusToken(s.key) }} />
            <span className="truncate text-ink-600">{s.label}</span>
            <span className="ml-auto tabular-nums text-ink-900">{s.value}</span>
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
