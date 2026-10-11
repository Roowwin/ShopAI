import type { ComponentPropsWithoutRef } from "react";
import { cn } from "./cn";

/* Native select - the Input of drop-downs, at the same 36px control height (`py-2` over
   text-sm's 20px line box). Admin-only: the storefront has no drop-downs.

   No `w-full` in the base, unlike Input. A select is used both as a full-width form field (AI
   listings) and as an intrinsic-width picker (workbench status, CMS offer kind), and with no
   tailwind-merge a base width would beat the caller's by stylesheet order. Width is layout, so
   the caller passes it: `<Select className="w-full">` for the full-width case - see cn.ts. */
type Props = ComponentPropsWithoutRef<"select">;

export default function Select({ className, ...rest }: Props) {
  return (
    <select
      className={cn(
        "rounded-control ring-1 ring-line bg-surface px-4 py-2 text-sm text-ink-900 outline-none transition focus:ring-2 focus:ring-brand-700",
        className,
      )}
      {...rest}
    />
  );
}
