"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/app/components/ui";
import { kickerClass } from "@/lib/ui";

/* The live activity record for the intake calls.

   Every line in it is a real event from a request this page actually made: the moment a call is
   dispatched, the payload's own answer, or the API's own refusal detail, kept verbatim. Nothing
   is generated on a timer and there is no progress bar - this API reports no progress at all, so
   a percentage here would be a number the payload never produced. While a call is in flight the
   panel says what it is waiting on, and nothing more.

   The record holds no control and writes nothing. Its ground is the page step rather than the
   card step, which is what makes it read as a console set into the panel; that fill is opaque,
   so the pairs measured for it are the ones that apply inside it (see the job report).

   The scroll region takes focus so a keyboard reader can reach the older lines, which is the
   same reason the workbench's row list takes it. Its focus cue is drawn INSIDE its own edge:
   a scroller clips what leaves its box, so an outset cue would be trimmed on the side it was
   drawn. The padding gives the lines room to be read against the fill. */

export type Level = "INFO" | "AI" | "WARN";

export type StreamEvent = {
  /** the page's own counter - this is the React key and the ordering, never a claim */
  seq: number;
  /** the real clock time, captured where the event happened */
  at: string;
  level: Level;
  text: string;
};

const TAG_INK: Record<Level, string> = {
  INFO: "text-ink-400",
  AI: "text-brand-300",
  WARN: "text-accent-700",
};

export default function ValidationStream({ events, pending, idle }: {
  events: StreamEvent[];
  /** what an in-flight call is waiting on, or null when nothing is out */
  pending: string | null;
  /** the line shown before any call has been made */
  idle: string;
}) {
  const box = useRef<HTMLDivElement | null>(null);

  /* Follow the tail: a record that stops at the fold on its newest line hides the thing the
     reader opened it for. */
  useEffect(() => {
    const el = box.current;
    if (el) { el.scrollTop = el.scrollHeight; }
  }, [events.length, pending]);

  return (
    <section>
      <p className={kickerClass}>Activity</p>
      <div
        ref={box}
        role="log"
        aria-live="polite"
        aria-label="Intake activity"
        tabIndex={0}
        className={cn(
          "mt-2 max-h-72 overflow-y-auto rounded-card bg-surface-sunken p-3 font-mono text-xs",
          "ring-1 ring-line outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500",
        )}
      >
        {events.length === 0 && !pending && <p className="text-ink-400">[INFO] {idle}</p>}
        <ul className="space-y-1">
          {events.map((e) => (
            <li key={e.seq} className="flex gap-2">
              <span className="shrink-0 tabular-nums text-ink-500">{e.at}</span>
              <span className={cn("shrink-0 font-semibold", TAG_INK[e.level])}>[{e.level}]</span>
              <span className="min-w-0 flex-1 break-words text-ink-600">{e.text}</span>
            </li>
          ))}
        </ul>
        {pending && (
          <p className="flex gap-2 pt-1">
            <span className="shrink-0 font-semibold text-ink-400">[..]</span>
            <span className="text-ink-400">waiting on {pending}</span>
          </p>
        )}
      </div>
      <p className="mt-2 text-xs text-ink-500">
        Fed only by the calls this page makes. The API reports no progress mid-call, so the
        record carries a call's start and its answer, and nothing in between.
      </p>
    </section>
  );
}
