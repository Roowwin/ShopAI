import type { ReactNode } from "react";
import { cn } from "./cn";

/* Borderless by design. A card is separated from the warm page by its white surface, its
   rounded-2xl corner and a layered shadow - not by a hairline, so a page of cards reads as a
   set of raised panels rather than a grid of outlined boxes. The base sets no padding of its
   own: the caller owns it, and cards are generous with it. */
type Props = {
  children: ReactNode;
  /** brand = the soft emerald callout surface (ContentPage's `Note`). */
  tone?: "default" | "brand";
  interactive?: boolean;
  href?: string;
  className?: string;
};

const TONE: Record<"default" | "brand", string> = {
  default: "bg-surface",
  brand: "bg-brand-50 text-brand-900",
};

/* An interactive card is a link: the shadow deepens and it lifts on hover, settles back on
   press, and takes the same emerald focus ring as a button so tabbing to a product tile is
   visible. Motion tokens throughout; reduced motion keeps the shadow cue and drops the lift. */
const INTERACTIVE =
  "hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0 " +
  "transition duration-base ease-out " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2 " +
  "motion-reduce:transition-none motion-reduce:hover:translate-y-0 motion-reduce:active:translate-y-0";

export default function Card({ children, tone = "default", interactive = false, href, className }: Props) {
  const cls = cn(
    "rounded-2xl shadow-sm",
    TONE[tone],
    interactive && INTERACTIVE,
    className,
  );
  if (href) return <a href={href} className={cls}>{children}</a>;
  return <div className={cls}>{children}</div>;
}
