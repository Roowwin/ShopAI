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
  /** brand = the soft emerald callout surface (was ContentPage's `Note`). */
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

/* An interactive card is a link: it lifts and warms its ring on hover, settles back down on
   press, and takes the same emerald focus ring as a button so tabbing to a product tile is
   visible. `ring-2` on focus wins over the base `ring-1` by stylesheet order, the same way the
   Button variants already rely on. Motion tokens throughout; reduced motion keeps the colour
   cue and drops the lift. */
const INTERACTIVE =
  "hover:ring-brand-300 hover:-translate-y-0.5 active:translate-y-0 " +
  "transition duration-base ease-out " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2 " +
  "motion-reduce:transition-none motion-reduce:hover:translate-y-0 motion-reduce:active:translate-y-0";

export default function Card({ children, radius = "card", tone = "default", interactive = false, href, className }: Props) {
  const cls = cn(
    "ring-1",
    TONE[tone],
    RADIUS[radius],
    interactive && INTERACTIVE,
    className,
  );
  if (href) return <a href={href} className={cls}>{children}</a>;
  return <div className={cls}>{children}</div>;
}
