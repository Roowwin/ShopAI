import type { ReactNode } from "react";
import { cn } from "./cn";

/* GLASS. A card is a translucent panel floating on the ground gradient - a 5% white tint over a
   backdrop blur, outlined by a single brand hairline at 20% - rather than the opaque white slab it
   was. That is the whole visual language of this design: nothing sits flat on the page, everything
   sits slightly above it.

   The border is `ring-1` and not `border`: the ring is drawn INSIDE the box's radius, so it traces
   the rounded corner instead of being squared off by it, and it composes with the focus ring on the
   interactive variant instead of fighting a `border` for the same pixel. The colour is the brand at
   20% - the brief asks for emerald there, and the brand ladder IS this app's emerald.

   `backdrop-blur-md` is the expensive part: it makes the compositor blur whatever is behind every
   panel. It is worth it on a catalog grid of a dozen tiles and it would not be worth it on a
   thousand-row table, which is why the backoffice's cards stay opaque.

   No padding of its own: the caller owns it, and cards are generous with it. */
type Props = {
  children: ReactNode;
  /** brand = the tinted callout surface (ContentPage's `Note`): the brand at 10% instead of white. */
  tone?: "default" | "brand";
  interactive?: boolean;
  href?: string;
  className?: string;
};

const SHELL = "rounded-card ring-1 ring-line backdrop-blur-md";

const TONE: Record<"default" | "brand", string> = {
  /* The design's floating container: the raised surface at 80%, so the ground reads faintly
     through it, on the #264D40 hairline (`--line`). It was a 5% white film; this is the green
     panel the system actually asks for, and the difference is the point - a white film over a
     brass-and-green page reads grey. */
  default: "bg-surface/80",
  brand: "bg-brand-700/10 text-brand-300",
};

/* An interactive card is a link: it takes the brand glow and lifts on hover, settles back on
   press, and carries the same focus ring as a button so tabbing to a product tile is visible.
   Motion tokens throughout; reduced motion keeps the glow and drops the lift. */
const INTERACTIVE =
  "hover:shadow-glow-sm hover:-translate-y-0.5 active:translate-y-0 " +
  "transition duration-base ease-out " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 focus-visible:ring-offset-2 " +
  "motion-reduce:transition-none motion-reduce:hover:translate-y-0 motion-reduce:active:translate-y-0";

export default function Card({ children, tone = "default", interactive = false, href, className }: Props) {
  const cls = cn(SHELL, TONE[tone], interactive && INTERACTIVE, className);
  if (href) return <a href={href} className={cls}>{children}</a>;
  return <div className={cls}>{children}</div>;
}
