import type { ReactNode } from "react";
import { cn } from "./cn";

type Variant = "primary" | "accent" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

/* DELIBERATE DIVERGENCE from the storefront, which puts `min-h-[44px]` in the base because
   every storefront button is a touch surface. The backoffice is a desktop, pointer-first
   internal tool, so the base carries a denser ~36px control height instead. This is not the
   storefront's 44px rule left half-applied - do not "fix" it back. */
const BASE =
  "inline-flex items-center justify-center gap-2 min-h-[36px] rounded-control font-semibold transition " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 " +
  "disabled:opacity-50 disabled:pointer-events-none";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand-600 text-white hover:bg-brand-500",
  accent: "bg-accent-400 text-ink-900 hover:bg-accent-300",
  secondary: "bg-surface text-brand-700 ring-1 ring-line hover:bg-brand-50",
  ghost: "text-brand-700 hover:bg-brand-50",
  danger: "bg-surface text-danger-600 ring-1 ring-danger-200 hover:bg-danger-50",
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
