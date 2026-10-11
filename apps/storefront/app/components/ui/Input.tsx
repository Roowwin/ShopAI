import type { ComponentPropsWithoutRef } from "react";
import { cn } from "./cn";

/* light = white fill (cart, assistant); sunken = slate fill, for the header search which sits
   on a white bar and needs the contrast; dark = the dark footer newsletter input.
   All three carry a focus highlight, which only the header search had before. */
const TONES: Record<"light" | "sunken" | "dark", string> = {
  light: "bg-surface text-ink-900 ring-1 ring-line placeholder:text-ink-500",
  sunken: "bg-surface-sunken text-ink-900 ring-1 ring-line placeholder:text-ink-600",
  dark: "bg-ink-900/60 text-white ring-1 ring-ink-700 placeholder:text-ink-400",
};

type Props = ComponentPropsWithoutRef<"input"> & { tone?: "light" | "sunken" | "dark" };

export default function Input({ tone = "light", className, ...rest }: Props) {
  return (
    <input
      className={cn(
        "w-full rounded-control px-4 py-2.5 text-sm outline-none transition focus:ring-2 focus:ring-brand-700",
        TONES[tone],
        className,
      )}
      {...rest}
    />
  );
}
