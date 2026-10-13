import type { ReactNode } from "react";
import { cn } from "./cn";

type Variant = "primary" | "primaryOnDark" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

/* `min-h-[44px]` lives in the base so every button clears the ~44px touch target, including
   the ones that used to be px-3 py-1.5 (≈28px).

   The full state set, once, for every button on the site: hover = a shade shift (per variant),
   active = the same element sinking 1px and darkening one more step, focus-visible = the 2px
   focus ring for keyboard users, disabled = muted and inert. Duration and curve come from the
   motion tokens, and the reduced-motion pair cancels the 1px movement for anyone who has asked
   for no motion (a 0ms transition would still move it).

   THE RING COLOUR LIVES IN THE VARIANTS, NOT IN THE BASE. It used to be `ring-brand-700` in the
   base, which is right on the warm ground (7.9:1) and wrong the moment a button sits on charcoal
   (2.26:1 - a focus indicator that fails the 3:1 non-text bar, and one that is invisible against
   its own brand-700 fill besides). A single base value cannot serve both grounds, and a caller
   cannot override it either: `cn` does not dedupe, and two `focus-visible:ring-<colour>` classes
   resolve by Tailwind's own emission order rather than by which one the caller wrote last. So it
   is per variant, and `primaryOnDark` is the one that differs.

   Palette, round 2: only `primary` carries the brand hue - it is THE accent, so a solid brand
   button is the one loud thing on a page. Secondary is a white button on a hairline and ghost is
   transparent; both step through neutral fills, so the brand never appears as a large area and
   the eye always knows which control is the action. */
const BASE =
  "inline-flex items-center justify-center gap-2 min-h-[44px] rounded-control font-semibold " +
  "transition duration-fast ease-out active:translate-y-px " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 " +
  "disabled:opacity-50 disabled:pointer-events-none " +
  "motion-reduce:transition-none motion-reduce:active:translate-y-0";

const VARIANTS: Record<Variant, string> = {
  // white on brand-700 is the darkest green step that still clears 4.5:1 - do not lighten it
  primary: "bg-brand-700 text-white hover:bg-brand-800 active:bg-brand-900 focus-visible:ring-brand-700",
  /* The same fill and the same white ink, on a DARK ground (the product page). Only the ring
     changes: brand-300 is the one brand step light enough to be seen against charcoal. The fill
     is deliberately identical, so the shop's primary action is the same colour everywhere. */
  primaryOnDark: "bg-brand-700 text-white hover:bg-brand-800 active:bg-brand-900 focus-visible:ring-brand-300",
  secondary: "bg-surface text-ink-700 ring-1 ring-line hover:bg-surface-sunken hover:ring-line-strong active:bg-surface-pressed focus-visible:ring-brand-700",
  ghost: "text-ink-700 hover:bg-surface-sunken active:bg-surface-pressed focus-visible:ring-brand-700",
  danger: "bg-surface text-danger-600 ring-1 ring-danger-200 hover:bg-danger-50 active:bg-danger-200 focus-visible:ring-brand-700",
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
