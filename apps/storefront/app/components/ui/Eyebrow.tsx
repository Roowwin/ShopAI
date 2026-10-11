import type { ReactNode } from "react";
import { cn } from "./cn";

/* The uppercase kicker above headings. `text-eyebrow` carries the size and tracking, so the
   old text-[11px] / text-[10px] and the three different tracking-* values are all one thing.
   Medium weight keeps an 11px uppercase line from reading as a hairline at the top of a card;
   ink-400 is the muted end of the colour rhythm (body copy is ink-600, meta ink-500). */
export default function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-eyebrow font-medium uppercase text-ink-400", className)}>{children}</p>;
}
