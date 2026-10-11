import type { ComponentPropsWithoutRef } from "react";
import { cn } from "./cn";

/* light = white fill, the default for form rows; sunken = slate fill, for a field that sits on
   a white bar and needs the contrast; dark = a field on a dark surface. All three carry a
   focus ring, which the pre-design-system inputs did not. */
const TONES: Record<"light" | "sunken" | "dark", string> = {
  light: "bg-surface text-ink-900 ring-1 ring-line placeholder:text-ink-400",
  sunken: "bg-surface-sunken text-ink-900 ring-1 ring-line placeholder:text-ink-400",
  dark: "bg-ink-900/60 text-white ring-1 ring-ink-700 placeholder:text-ink-500",
};

type Props = ComponentPropsWithoutRef<"input"> & { tone?: "light" | "sunken" | "dark" };

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
