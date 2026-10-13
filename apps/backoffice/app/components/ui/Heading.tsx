import type { ElementType, ReactNode } from "react";
import { cn } from "./cn";

/* The single answer to "same heading level, different size on every page". Every page h1 is
   28px. `as` lets a section heading keep its semantic tag (h2) while taking the h3 size.

   The size, weight, leading and tracking of each level now come from the `display`/`h1`/`h2`/`h3`
   steps of the type scale in tailwind.config.ts, and the face from Space Grotesk (`font-display`).
   Before this the file spelled its own sizes, because the config carried only `eyebrow` and there
   was no step to name - which is how the same heading level ended up at three sizes across the
   app. This file now decides only which level maps to which tag, exactly as the storefront's does,
   so the rhythm cannot drift one page at a time and the two apps share one scale.

   No colour is set here on purpose: headings inherit, so a heading on a card is ink-900 and one on
   a brand-50 banner keeps whatever its container set. */
type Level = "display" | "h1" | "h2" | "h3";

const LEVELS: Record<Level, { tag: ElementType; className: string }> = {
  display: { tag: "h1", className: "font-display text-display" },
  h1: { tag: "h1", className: "font-display text-h1" },
  h2: { tag: "h2", className: "font-display text-h2" },
  h3: { tag: "h3", className: "font-display text-h3" },
};

type Props = {
  children: ReactNode;
  level?: Level;
  as?: ElementType;
  className?: string;
};

export default function Heading({ children, level = "h1", as, className }: Props) {
  const spec = LEVELS[level];
  const Tag = as ?? spec.tag;
  return <Tag className={cn(spec.className, className)}>{children}</Tag>;
}
