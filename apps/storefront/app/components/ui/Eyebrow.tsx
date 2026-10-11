import type { ReactNode } from "react";
import { cn } from "./cn";

/* The uppercase kicker above headings. `text-eyebrow` carries the size and tracking, so the
   old text-[11px] / text-[10px] and the three different tracking-* values are all one thing.
   Medium weight keeps an 11px uppercase line from reading as a hairline at the top of a card.

   Two tones, both from the colour rhythm: `muted` (ink-400) is the default inside a card, and
   `brand` (emerald) is the rare accent kicker - the hero's "RFO Store" is the only one today.
   A caller never passes a text colour of its own; see cn.ts, an appended class could not
   reliably replace this one. */
const TONES: Record<"muted" | "brand", string> = {
  muted: "text-ink-400",
  brand: "text-brand-700",
};

type Props = { children: ReactNode; tone?: "muted" | "brand"; className?: string };

export default function Eyebrow({ children, tone = "muted", className }: Props) {
  return <p className={cn("text-eyebrow font-medium uppercase", TONES[tone], className)}>{children}</p>;
}
