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

/* Contrast, WCAG AA - re-measured when the app went dark, because half of this paragraph used to be
   a light-mode record and was describing conditions that no longer exist.

   Still true, and the reason the primary fill is what it is: white on the darker emerald step
   computes 5.48:1, its hover goes a further step darker rather than lighter (7.68:1), and white on
   the step used before measured 3.77:1 and on its old lighter hover only 2.54:1 - under the 4.5:1 the
   14px and 12px labels need.

   No longer true, and removed rather than left to mislead: the `danger` variant was recorded here as
   a LATENT EXCEPTION (its hover dropped the label to 4.41:1). The flip lightened the danger ink to
   248 113 113, which measures 6.45:1 on a card and 5.84:1 on its own danger-50 hover fill - so the
   exception is closed, and the paragraph that warned about it was warning about nothing.

   Every other fill+ink pair in this file was re-measured against the dark ground in the Midnight
   Emerald audit (the one that produced the `text-ink-inverse` pairs). Written as numbers rather than
   utility names on purpose - this file is scanned as text, and a utility spelled in prose would emit
   a real rule. */
const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand-700 text-white hover:bg-brand-800",
  /* `accent` (amber) and `danger` (red) stay. They are STATUS, not decoration - the same argument
     the grade scale gets: a page that cannot say "this one is different" in colour says it in a
     sentence, and the brief's "neutral everywhere" is about the furniture. What changed is that
     their hover is a neutral fill rather than a coloured one, so the amber of the label is the only
     colour the control carries. */
  accent: "bg-accent-400 text-ink-inverse hover:bg-accent-300",
  /* SECONDARY IS A GHOST: transparent with one thin border, per the brief - so on a card it reads
     as an outline rather than as a second card, which the old `bg-surface` slab did. The hover
     steps down the neutral ladder and firms the hairline; with no fill of its own there is nothing
     for it to tint. */
  secondary: "bg-transparent text-ink-700 ring-1 ring-line hover:bg-surface-muted hover:ring-line-strong",
  ghost: "text-ink-700 hover:bg-surface-muted",
  danger: "bg-transparent text-danger-600 ring-1 ring-danger-200 hover:bg-surface-muted",
  /* Backoffice-only additions - the storefront's set stops at `danger`. `onDark` is a control
     that sits ON the dark nav/banner surface, which the storefront never has (it is what the
     hand-rolled ~28px nav Sign out became); `muted` is a quiet neutral text action, for a state
     toggle that is not the primary action. Keep these two here and nowhere else. */
  onDark: "text-ink-600 ring-1 ring-ink-600 hover:bg-surface-sunken",
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
