import type { ReactNode } from "react";
import { cn } from "./cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

/* `min-h-[44px]` lives in the base so every button clears the ~44px touch target, including
   the ones that used to be px-3 py-1.5 (≈28px).

   The full state set, once, for every button on the site: hover = a shade shift (per variant),
   active = the same element sinking 1px and darkening one more step, focus-visible = the 2px
   emerald ring for keyboard users, disabled = muted and inert. Duration and curve come from the
   motion tokens, and the reduced-motion pair cancels the 1px movement for anyone who has asked
   for no motion (a 0ms transition would still move it).

   Palette, round 2: only `primary` carries emerald - it is THE accent, so a solid emerald button
   is the one loud thing on a page. Secondary is a white button on a slate hairline and ghost is
   transparent; both step through neutral slate fills, so emerald never appears as a large area
   and the eye always knows which control is the action. */
const BASE =
  "inline-flex items-center justify-center gap-2 min-h-[44px] rounded-control font-semibold " +
  "transition duration-fast ease-out active:translate-y-px " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2 " +
  "disabled:opacity-50 disabled:pointer-events-none " +
  "motion-reduce:transition-none motion-reduce:active:translate-y-0";

const VARIANTS: Record<Variant, string> = {
  // white on brand-700 is the darkest emerald step that still clears 4.5:1 - do not lighten it
  primary: "bg-brand-700 text-white hover:bg-brand-800 active:bg-brand-900",
  secondary: "bg-surface text-ink-700 ring-1 ring-line hover:bg-surface-sunken hover:ring-line-strong active:bg-surface-pressed",
  ghost: "text-ink-700 hover:bg-surface-sunken active:bg-surface-pressed",
  danger: "bg-surface text-danger-600 ring-1 ring-danger-200 hover:bg-danger-50 active:bg-danger-200",
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
};

export default function Button({ children, variant = "primary", size = "md", className, href, as, type = "button", disabled, onClick }: Props) {
  const cls = cn(BASE, VARIANTS[variant], SIZES[size], className);
  const Tag = (as ?? (href ? "a" : "button")) as "button" | "a" | "span";
  if (Tag === "a") {
    return <a href={href} className={cls} onClick={onClick}>{children}</a>;
  }
  if (Tag === "span") {
    return <span className={cls}>{children}</span>;
  }
  return <button type={type} className={cls} disabled={disabled} onClick={onClick}>{children}</button>;
}
