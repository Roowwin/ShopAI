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

   THE RING IS `brand-300` ON EVERY VARIANT - the same selector, but the VALUE is neutral now.
   brand-300 was the brand's own ink step in the brass and forest passes; this pass repointed it to
   slate-200, because a focus indicator is an affordance rather than a brand moment (see the header
   of globals.css). It is a light neutral, so it clears the 3:1 non-text bar against the canvas, a
   card AND the forest fill it sits on. A caller still cannot override it: `cn` does not dedupe, and
   two `focus-visible:ring-<colour>` classes resolve by Tailwind's emission order rather than by
   which one the caller wrote last.

   Palette: only `primary` carries the brand hue, because the brief for this pass allows the forest
   green in exactly one place - the primary action. Secondary is a transparent outline and ghost is
   a bare text action, so both step through neutral fills and the eye always knows which control is
   the action without a second colour being spent on it. */
const BASE =
  "inline-flex items-center justify-center gap-2 min-h-[44px] rounded-control font-semibold " +
  "transition duration-fast ease-out active:translate-y-px " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 " +
  "disabled:opacity-50 disabled:pointer-events-none " +
  "motion-reduce:transition-none motion-reduce:active:translate-y-0";

const VARIANTS: Record<Variant, string> = {
  /* THE PRIMARY BUTTON IS THE ONLY COLOUR IN THE APP. Forest green #245B45 as a fill, WHITE as its
     label - and the label flipped back to white in this pass. It was `ink-inverse` (the dark
     canvas) because brass is a BRIGHT fill: white on #B08D57 measured 2.9:1. Forest is a dark one,
     so white on it measures 7.9:1 and the dark label would have been the unreadable one. The hover
     goes DOWN the ladder (800, then 900 on press) rather than up, because there is no green above
     700 to go to and a fill that brightens on hover reads as a warning, not a welcome. */
  primary: "bg-brand-700 text-white hover:bg-brand-800 active:bg-brand-900 focus-visible:ring-brand-300",
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
