"use client";

/* A single-series line chart, hand-drawn in SVG.

   WHY NOT A DUAL AXIS. Revenue (dollars) and order volume (a count) are different scales, and the
   one thing a chart must never do is put them on two y-axes - the crossing point of two unrelated
   scales is meaningless, and it is the single most common way a dashboard lies. So the screen draws
   TWO of these, one per measure, sharing an x-axis: same 31 days, two honest y-axes, no shared
   geometry to misread.

   ONE SERIES PER CHART, so there is no legend to draw - the card's title names the measure, which is
   the identity. The colour is chosen per chart and is NOT free: both hues are from the reference
   categorical palette's dark steps and were run through the palette validator against this app's own
   chart surface (`--surface`, slate-900) before either was used - lightness band, chroma floor,
   colourblind separation and contrast all pass there, which is not true of an arbitrary pair.

   HOVER IS THE DEFAULT, not an extra: a crosshair marks the day, a dot marks the value, and a
   tooltip names the date and the figure. The hit target is the whole column, not the 2px line. */

import { useCallback, useMemo, useRef, useState } from "react";

export type Point = { label: string; value: number };

// Geometry. The viewBox is fixed and the SVG scales to its container, so the maths below is in
// viewBox units and the pointer is converted into them on the way in.
const W = 720;
const H = 220;
const PAD = { top: 16, right: 16, bottom: 26, left: 64 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

// The grid the line is read against. Four steps is enough to locate a value without competing with
// the mark; the hairlines are the app's own line token, which is recessive by construction.
const STEPS = 4;

export default function LineChart({ title, subtitle, points, colour, format, empty }:
  { title: string; subtitle?: string; points: Point[]; colour: string;
    format: (v: number) => string; empty?: string }) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  const max = useMemo(() => Math.max(1, ...points.map((p) => p.value)), [points]);
  const x = useCallback((i: number) =>
    PAD.left + (points.length <= 1 ? PLOT_W / 2 : (i / (points.length - 1)) * PLOT_W), [points.length]);
  const y = useCallback((v: number) => PAD.top + PLOT_H - (v / max) * PLOT_H, [max]);

  const path = useMemo(
    () => points.map((p, i) => `${i ? "L" : "M"} ${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(" "),
    [points, x, y]);

  // The x tick labels: first, last and a few between - never every day, which at 365 points is
  // unreadable and at 31 is noise.
  const ticks = useMemo(() => {
    const n = points.length;
    if (n <= 1) return [0];
    const step = Math.max(1, Math.ceil(n / 6));
    const out: number[] = [];
    for (let i = 0; i < n; i += step) out.push(i);
    if (out[out.length - 1] !== n - 1) out.push(n - 1);
    return out;
  }, [points.length]);

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || points.length === 0) return;
    // Into viewBox units, then into an index. Clamped, so dragging past either edge pins to the end
    // rather than clearing the readout.
    const vx = ((e.clientX - rect.left) / rect.width) * W;
    const ratio = (vx - PAD.left) / PLOT_W;
    const i = Math.round(ratio * (points.length - 1));
    setHover(Math.max(0, Math.min(points.length - 1, i)));
  }

  const flat = points.every((p) => p.value === 0);
  const last = points[points.length - 1];
  const active = hover === null ? null : points[hover];

  return (
    <div className="relative">
      <div className="flex flex-wrap items-baseline gap-2">
        <p className="text-sm font-medium text-ink-900">{title}</p>
        {subtitle && <p className="text-xs text-ink-500">{subtitle}</p>}
      </div>

      {flat && empty ? (
        <p className="mt-4 mb-2 text-sm text-ink-500">{empty}</p>
      ) : (
        <>
          <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="mt-2 w-full"
               role="img" aria-label={`${title}: line chart`}
               onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
            {/* Gridlines and their value labels, in the muted ink - never the series colour. */}
            {Array.from({ length: STEPS + 1 }, (_, i) => {
              const v = (max / STEPS) * (STEPS - i);
              const gy = PAD.top + (PLOT_H / STEPS) * i;
              return (
                <g key={i}>
                  <line x1={PAD.left} x2={W - PAD.right} y1={gy} y2={gy}
                        stroke="rgb(var(--line))" strokeWidth="1" />
                  <text x={PAD.left - 8} y={gy + 3} textAnchor="end" fontSize="10"
                        fill="rgb(var(--ink-500))" style={{ fontVariantNumeric: "tabular-nums" }}>
                    {format(v)}
                  </text>
                </g>
              );
            })}

            {ticks.map((i) => (
              <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize="10"
                    fill="rgb(var(--ink-500))">
                {points[i].label.slice(5)}
              </text>
            ))}

            {/* The crosshair sits UNDER the mark so it never colours the data. */}
            {hover !== null && (
              <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + PLOT_H}
                    stroke="rgb(var(--line-strong))" strokeWidth="1" />
            )}

            <path d={path} fill="none" stroke={colour} strokeWidth="2"
                  strokeLinejoin="round" strokeLinecap="round" />

            {/* 8px marker with a 2px surface ring, so an overlapping point still reads. */}
            {hover !== null && (
              <circle cx={x(hover)} cy={y(points[hover].value)} r="4" fill={colour}
                      stroke="rgb(var(--surface))" strokeWidth="2" />
            )}

            {/* ONE direct label, on the last point - the latest figure is the one a reader wants
                without hovering, and labelling every point is noise. */}
            {last && !flat && (
              <text x={x(points.length - 1)} y={y(last.value) - 10} textAnchor="end" fontSize="11"
                    fontWeight="600" fill="rgb(var(--ink-900))">
                {format(last.value)}
              </text>
            )}
          </svg>

          {active && (
            <div className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 rounded-control
                            bg-surface-sunken px-3 py-1.5 text-xs ring-1 ring-line">
              <span className="text-ink-500">{active.label}</span>{" "}
              <span className="font-medium text-ink-900">{format(active.value)}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
