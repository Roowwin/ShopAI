import type { ReactNode } from "react";
import { cn } from "./cn";

/* QUIET PANELS. A card is an OPAQUE panel - white on the light ground, charcoal before it - on a
   single neutral hairline. It used to be
   glass - the raised surface at 80% under a `backdrop-blur-md`, so the gradient ground showed
   faintly through it - and the brief for this pass is subtraction: the blur is the most expensive
   thing on the page (every panel makes the compositor blur what is behind it) and the least
   visible, and with the ground gradient gone there is nothing behind a card worth showing.

   The border is `ring-1` and not `border`: the ring is drawn INSIDE the box's radius, so it traces
   the rounded corner instead of being squared off by it, and it composes with the focus ring on the
   interactive variant instead of fighting a `border` for the same pixel.

   No padding of its own: the caller owns it, and cards are generous with it. */
type Props = {
  children: ReactNode;
  /** brand = the tinted callout surface (ContentPage's `Note`). It used to be a brand wash; the
      brand is fill-only now, so a Note is told apart by a LIGHTER NEUTRAL panel instead. */
  tone?: "default" | "brand";
  interactive?: boolean;
  href?: string;
  className?: string;
};

const SHELL = "rounded-card ring-1 ring-line";

const TONE: Record<"default" | "brand", string> = {
  default: "bg-surface",
  brand: "bg-surface-muted text-ink-700",
};

/* An interactive card is a link. It FIRMS ITS HAIRLINE under the cursor and takes the same focus
   ring as a button, so tabbing to a product tile is visible. It no longer blooms a brand glow and
   no longer lifts half a pixel: at a dozen tiles in a grid those two effects were most of the
   motion on the page, and "premium minimalist" is the absence of exactly that. */
const INTERACTIVE =
  "hover:ring-line-strong transition duration-base ease-out " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 focus-visible:ring-offset-2 " +
  "motion-reduce:transition-none";

export default function Card({ children, tone = "default", interactive = false, href, className }: Props) {
  const cls = cn(SHELL, TONE[tone], interactive && INTERACTIVE, className);
  if (href) return <a href={href} className={cls}>{children}</a>;
  return <div className={cls}>{children}</div>;
}
