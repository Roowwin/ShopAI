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

   THE RING IS `brand-300` ON EVERY VARIANT, because this app is now dark on every page. It used
   to be `ring-brand-700` in the base, correct on the old warm ground (7.9:1) and 2.3:1 on this
   one - a focus indicator that fails the 3:1 non-text bar and is invisible against its own
   brand-700 fill besides. The colour moved out of the base per variant so the dark pages could
   override it; now that there are no light pages, they are all the same value again and the
   variant-level declaration is kept only so that a future light surface has somewhere to put
   itself. A caller still cannot override it: `cn` does not dedupe, and two
   `focus-visible:ring-<colour>` classes resolve by Tailwind's emission order rather than by which
   one the caller wrote last.

   Palette: only `primary` carries the brand hue - it is THE accent, so a solid green button is the
   one loud thing on a page. Secondary is a glass button on a hairline and ghost is transparent;
   both step through neutral fills, so the brand never appears as a large area and the eye always
   knows which control is the action. */
const BASE =
  "inline-flex items-center justify-center gap-2 min-h-[44px] rounded-control font-semibold " +
  "transition duration-fast ease-out active:translate-y-px " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 " +
  "disabled:opacity-50 disabled:pointer-events-none " +
  "motion-reduce:transition-none motion-reduce:active:translate-y-0";

const VARIANTS: Record<Variant, string> = {
  // white on brand-700 is the darkest green step that still clears 4.5:1 - do not lighten it
  primary: "bg-brand-700 text-white hover:bg-brand-800 active:bg-brand-900 focus-visible:ring-brand-300",
  secondary: "bg-surface-glass/5 backdrop-blur-md text-ink-700 ring-1 ring-line hover:bg-surface-pressed hover:ring-line-strong active:bg-surface-pressed focus-visible:ring-brand-300",
  ghost: "text-ink-700 hover:bg-surface-pressed active:bg-surface-pressed focus-visible:ring-brand-300",
  danger: "bg-surface-glass/5 backdrop-blur-md text-danger-600 ring-1 ring-danger-200 hover:bg-surface-pressed active:bg-danger-50 focus-visible:ring-brand-300",
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
