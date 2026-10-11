import type { ReactNode } from "react";
import { cn } from "./cn";

type Variant = "primary" | "accent" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

/* `min-h-[44px]` lives in the base so every button clears the ~44px touch target, including
   the ones that used to be px-3 py-1.5 (≈28px).

   The full state set, once, for every button on the site: hover = a shade shift (per variant),
   active = the same element sinking 1px and darkening one more step, focus-visible = the 2px
   emerald ring for keyboard users, disabled = muted and inert. Duration and curve come from the
   motion tokens, and the reduced-motion pair cancels the 1px movement for anyone who has asked
   for no motion (a 0ms transition would still move it). */
const BASE =
  "inline-flex items-center justify-center gap-2 min-h-[44px] rounded-control font-semibold " +
  "transition duration-fast ease-out active:translate-y-px " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2 " +
  "disabled:opacity-50 disabled:pointer-events-none " +
  "motion-reduce:transition-none motion-reduce:active:translate-y-0";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand-700 text-white hover:bg-brand-800 active:bg-brand-900",
  accent: "bg-accent-400 text-ink-900 hover:bg-accent-300 active:bg-accent-500",
  secondary: "bg-surface text-brand-700 ring-1 ring-line hover:bg-brand-50 hover:ring-brand-300 active:bg-brand-100",
  ghost: "text-brand-700 hover:bg-brand-50 active:bg-brand-100",
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
