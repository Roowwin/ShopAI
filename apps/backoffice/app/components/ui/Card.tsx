import type { ReactNode } from "react";
import { cn } from "./cn";

/* Radius and padding are separate, single-valued choices on purpose: there is no
   tailwind-merge, so two utilities for the same property would resolve by stylesheet order
   rather than by intent. The base sets no padding and no background of its own - `tone`
   owns the background, the caller owns the padding. */
type Props = {
  children: ReactNode;
  /** card = content panels (16px); control = product tiles, callouts (12px). */
  radius?: "card" | "control";
  /** brand = the soft emerald callout surface. */
  tone?: "default" | "brand";
  interactive?: boolean;
  href?: string;
  className?: string;
};

const RADIUS: Record<"card" | "control", string> = {
  card: "rounded-card",
  control: "rounded-control",
};

const TONE: Record<"default" | "brand", string> = {
  default: "bg-surface ring-line",
  brand: "bg-brand-50 ring-brand-100 text-brand-900",
};

export default function Card({ children, radius = "card", tone = "default", interactive = false, href, className }: Props) {
  const cls = cn(
    "ring-1",
    TONE[tone],
    RADIUS[radius],
    interactive && "hover:ring-brand-300 hover:-translate-y-0.5 transition",
    className,
  );
  if (href) return <a href={href} className={cls}>{children}</a>;
  return <div className={cls}>{children}</div>;
}
