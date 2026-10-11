import type { ElementType, ReactNode } from "react";
import { cn } from "./cn";

/* The single answer to "same heading level, different size on every page". The size, weight,
   leading and tracking of each level now come from the `display`/`h1`/`h2`/`h3` steps of the type
   scale in tailwind.config.ts - this file only decides which level maps to which tag, so the
   rhythm cannot drift one page at a time. The hero is the one intentional `display`.

   No colour is set here on purpose: headings inherit, which is what keeps the hero's h1 white on
   the dark band while every h2 on a card is ink-900 from the body. */
type Level = "display" | "h1" | "h2" | "h3";

const LEVELS: Record<Level, { tag: ElementType; className: string }> = {
  display: { tag: "h1", className: "text-display" },
  h1: { tag: "h1", className: "text-h1" },
  h2: { tag: "h2", className: "text-h2" },
  h3: { tag: "h3", className: "text-h3" },
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
