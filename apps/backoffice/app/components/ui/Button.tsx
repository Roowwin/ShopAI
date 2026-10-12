import type { ReactNode } from "react";
import { cn } from "./cn";

type Variant = "primary" | "accent" | "secondary" | "ghost" | "danger" | "onDark" | "muted";
type Size = "sm" | "md" | "lg" | "inline";

/* 36px is the backoffice's ONE control height, and Button and Input/Select both land on it
   (Input/Select carry the matching `py-2` over text-sm's 20px line box). DELIBERATE DIVERGENCE
   from the storefront, which sets a 44px minimum height in the base because every storefront
   button is a touch surface. The backoffice is a desktop, pointer-first internal tool. This is
   not the storefront's 44px rule left half-applied - do not "fix" it back.
   (The comment says "a 44px minimum height" rather than spelling the utility: Tailwind scans
   source text, not code, so writing the class here would emit a stray 44px rule into the built
   CSS and make the one-control-height claim look false.) */
const BASE =
  "inline-flex items-center justify-center gap-2 min-h-[36px] rounded-control font-semibold transition " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2 " +
  "disabled:opacity-50 disabled:pointer-events-none";

/* Contrast, WCAG AA. The primary fill is the darker emerald step (white on it computes 5.48:1)
   and its hover goes a further step darker rather than lighter (7.68:1), because white on the
   step used before measured 3.77:1 and on that variant's old lighter hover only 2.54:1 - both
   under the 4.5:1 the 14px and 12px labels need. The focus indicator every button shares is the
   same darker step (5.48:1 against white), clearing the 3:1 non-text bar the lighter emerald
   indicator was under at 2.54:1. The `muted` label is the heavier ink step for the same reason:
   at the middle step it passed on the white fill (4.76:1) but fell to 4.34:1 over the slate
   fill that variant takes on hover.
   ONE LATENT EXCEPTION, recorded rather than closed: the `danger` variant's hover fill drops
   its label from 4.83:1 to 4.41:1. No call site in this app uses that variant, and re-colouring
   it means a new danger token shared with the storefront - an owner decision, not a builder one.
   Written as numbers rather than utility names on purpose - this file is scanned as text, and a
   utility spelled in prose would emit a real rule. */
const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand-700 text-white hover:bg-brand-800",
  accent: "bg-accent-400 text-ink-inverse hover:bg-accent-300",
  secondary: "bg-surface text-brand-300 ring-1 ring-line hover:bg-brand-50",
  ghost: "text-brand-300 hover:bg-brand-50",
  danger: "bg-surface text-danger-600 ring-1 ring-danger-200 hover:bg-danger-50",
  /* Backoffice-only additions - the storefront's set stops at `danger`. `onDark` is a control
     that sits ON the dark nav/banner surface, which the storefront never has (it is what the
     hand-rolled ~28px nav Sign out became); `muted` is a quiet neutral text action, for a state
     toggle that is not the primary action. Keep these two here and nowhere else. */
  onDark: "text-ink-300 ring-1 ring-ink-600 hover:bg-ink-700",
  muted: "text-ink-600 hover:bg-surface-sunken",
};

const SIZES: Record<Size, string> = {
  sm: "text-xs px-3",
  md: "text-sm px-4",
  lg: "text-sm px-5",
  /* `inline` = an action inside a Table cell that must line up with the cell's own text (px-0,
     no offset), still at the one 36px control height. */
  inline: "text-sm px-0",
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
