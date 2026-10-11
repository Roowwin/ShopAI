import type { ElementType, ReactNode } from "react";
import { cn } from "./cn";

/* The single answer to "same heading level, different size on every page". Every page h1 is
   24px; the hero is the one intentional 30px `display`. */
type Level = "display" | "h1" | "h2" | "h3";

const LEVELS: Record<Level, { tag: ElementType; className: string }> = {
  display: { tag: "h1", className: "text-3xl font-semibold tracking-tight" },
  h1: { tag: "h1", className: "text-2xl font-semibold tracking-tight" },
  h2: { tag: "h2", className: "text-lg font-semibold" },
  h3: { tag: "h3", className: "text-sm font-semibold" },
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
