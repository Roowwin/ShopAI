"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/app/components/ui";
import { kickerClass } from "@/lib/ui";

/* The live activity record for the intake calls.

   Every line in it is a real event from something this page actually did. Nine of the fifteen
   lines the page can write come off a request: the moment one of the three calls is dispatched,
   the payload's own answer, or the API's own refusal detail, kept verbatim. The other six are the
   page's own account of a request, which no payload can supply:
     - the refusals it makes before it sends anything - no lot selected, no serial entered, a file
       that is not a photo;
     - the line it writes when a request could not be sent at all;
     - the line it writes when an answer arrived but could not be read;
     - the prefill that copies a draft's values into the scan-in fields.
   Nothing else is written: no line is generated on a timer and there is no progress bar, because
   this API reports no progress at all - a percentage here would be a number no payload produced.
   While a call is in flight the panel says what it is waiting on, and nothing more.

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
     reader opened it for.

     The dependency is the newest line's own counter, NOT the list length. The page caps the list
     (see EVENT_CAP), so once it is full an append leaves the length exactly where it was and this
     effect would never run again - which is precisely when a reader has the most lines to scroll
     past. The counter rises on every single append, capped or not. */
  const tail = events.length > 0 ? events[events.length - 1].seq : -1;
  useEffect(() => {
    const el = box.current;
    if (el) { el.scrollTop = el.scrollHeight; }
  }, [tail, pending]);

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
        Fed by this page's own calls, and by what it decides on its own - the refusals it makes, a
        request that could not be sent or read, and the prefill. No progress is reported mid-call,
        so the record carries a call's start and its answer, and nothing in between.
      </p>
    </section>
  );
}
