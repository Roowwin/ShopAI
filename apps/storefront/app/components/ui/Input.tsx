import type { ComponentPropsWithoutRef } from "react";
import { cn } from "./cn";

/* light = page/search/cart/assistant inputs; dark = the dark footer newsletter input.
   Both carry a focus ring, which only the header search had before. */
const TONES: Record<"light" | "dark", string> = {
  light: "bg-surface text-ink-900 ring-1 ring-line placeholder:text-ink-400",
  dark: "bg-ink-900/60 text-white ring-1 ring-slate-700 placeholder:text-ink-500",
};

type Props = ComponentPropsWithoutRef<"input"> & { tone?: "light" | "dark" };

export default function Input({ tone = "light", className, ...rest }: Props) {
  return (
    <input
      className={cn(
        "w-full rounded-control px-4 py-2.5 text-sm outline-none transition focus:ring-2 focus:ring-brand-500",
        TONES[tone],
        className,
      )}
      {...rest}
    />
  );
}
