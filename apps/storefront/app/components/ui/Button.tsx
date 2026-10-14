import type { ReactNode } from "react";
import { cn } from "./cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

/* `min-h-[44px]` lives in the base so every button clears the ~44px touch target, including
   the ones that used to be px-3 py-1.5 (≈28px).

   The full state set, once, for every button on the site: hover = a shade shift (per variant),
   active = the same element sinking 1px and darkening one more step, focus-visible = the 2px
   focus ring for keyboard users, disabled = muted and inert. Duration and curve come from the
   motion tokens, and the reduced-motion pair cancels the 1px movement for anyone who has asked
   for no motion (a 0ms transition would still move it).

   THE RING IS `brand-300` ON EVERY VARIANT - the same selector every pass has used, but the VALUE
   keeps moving with the ground. brand-300 is not the brand here: it is the "quiet ink/ring" step
   (see the header of globals.css), and a focus indicator is an affordance rather than a brand
   moment. It was slate-200 for the dark ground and is slate-600 now, because on a light page the
   ring has to be the DARK neutral - a light one would vanish into the canvas. It clears the 3:1
   non-text bar against the canvas, a card AND the emerald fill it sits on. A caller still cannot
   override it: `cn` does not dedupe, and two `focus-visible:ring-<colour>` classes resolve by
   Tailwind's emission order rather than by which one the caller wrote last.

   Palette: only `primary` carries the brand hue, because the brief allows the brand colour in
   exactly one place - the primary action. Secondary is a transparent outline and ghost is
   a bare text action, so both step through neutral fills and the eye always knows which control is
   the action without a second colour being spent on it. */
const BASE =
  "inline-flex items-center justify-center gap-2 min-h-[44px] rounded-control font-semibold " +
  "transition duration-fast ease-out active:translate-y-px " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 " +
  "disabled:opacity-50 disabled:pointer-events-none " +
  "motion-reduce:transition-none motion-reduce:active:translate-y-0";

const VARIANTS: Record<Variant, string> = {
  /* THE PRIMARY BUTTON IS THE ONLY COLOUR IN THE APP, and its LABEL FLIPS WITH THE GROUND - this is
     the third time, and it is the one line in this file that has to be re-read on every palette
     move. The rule is not "white" or "dark", it is "whichever ink the fill can carry":
       brass  #B08D57 (bright) -> ink-inverse, because white on it was 2.9:1
       forest #245B45 (dark)   -> white,       7.9:1
       emerald #34D399 (bright)-> ink-inverse, because white on it is 1.92:1
     The sweep (scripts/check-contrast.py) catches this and nothing else: on the light palette it
     reported exactly these two pairs, this fill and its hover, and no others across either app.
     The hover goes DOWN the ladder (800, then 900 on press) rather than up, because there is no
     emerald above 700 to go to and a fill that brightens on hover reads as a warning. */
  primary: "bg-brand-700 text-ink-inverse hover:bg-brand-800 active:bg-brand-900 focus-visible:ring-brand-300",
  /* SECONDARY IS A GHOST: transparent with one thin border, per the brief. It used to be a filled
     `bg-surface` slab on the same hairline, which on a card made it a second card; transparent lets
     whatever it sits on show through, so it reads as an outline and never as a panel. The hover is
     the surface step plus a firmer hairline - no fill change on an element that has no fill. */
  secondary: "bg-transparent text-ink-700 ring-1 ring-line hover:bg-surface-muted hover:ring-line-strong active:bg-surface-pressed focus-visible:ring-brand-300",
  ghost: "text-ink-700 hover:bg-surface-muted active:bg-surface-pressed focus-visible:ring-brand-300",
  danger: "bg-transparent text-danger-600 ring-1 ring-danger-200 hover:bg-surface-muted active:bg-danger-50 focus-visible:ring-brand-300",
};

const SIZES: Record<Size, string> = {
  sm: "text-xs px-3",
  md: "text-sm px-4",
  lg: "text-sm px-5",
};

type Props = {
  children: ReactNode;
  variant?: Variant;
  size?: Size;
  className?: string;
  /** Renders an <a>. Use `as="span"` instead when the button sits inside a larger link. */
  href?: string;
  as?: "button" | "a" | "span";
  type?: "button" | "submit";
  disabled?: boolean;
  onClick?: () => void;
  /** A toggle button (a filter chip): announces its selected state. Omitted on plain buttons. */
  pressed?: boolean;
  /** The control is mid-request. Sets `aria-busy` and nothing else - the caller still owns
      `disabled`, because whether a second press is safe is the caller's decision, not ours. */
  busy?: boolean;
};

export default function Button({ children, variant = "primary", size = "md", className, href, as, type = "button", disabled, onClick, pressed, busy }: Props) {
  const cls = cn(BASE, VARIANTS[variant], SIZES[size], className);
  const Tag = (as ?? (href ? "a" : "button")) as "button" | "a" | "span";
  if (Tag === "a") {
    return <a href={href} className={cls} onClick={onClick}>{children}</a>;
  }
  if (Tag === "span") {
    return <span className={cls}>{children}</span>;
  }
  return <button type={type} className={cls} disabled={disabled} aria-pressed={pressed} aria-busy={busy} onClick={onClick}>{children}</button>;
}
