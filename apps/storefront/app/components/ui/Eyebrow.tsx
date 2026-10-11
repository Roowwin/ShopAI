import type { ReactNode } from "react";
import { cn } from "./cn";

/* The uppercase kicker above headings. `text-eyebrow` carries the size and tracking, so the
   old text-[11px] / text-[10px] and the three different tracking-* values are all one thing. */
export default function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-eyebrow uppercase text-ink-400", className)}>{children}</p>;
}
