import type { ComponentPropsWithoutRef } from "react";
import { cn } from "./cn";

/* light = white fill (cart, assistant); sunken = slate fill, for the header search which sits
   on a white bar and needs the contrast; dark = the dark footer newsletter input.
   All three carry a focus highlight, which only the header search had before.

   Every field also gets a hover hairline (the boundary firms up before you click into it) and a
   pressed fill, both from tokens. A field does not take the Button's 1px sink - a text box that
   shifts under the cursor is a usability defect, not a state - so `active:` here is the darker
   shade on its own. */
const TONES: Record<"light" | "sunken" | "dark", string> = {
  light: "bg-surface text-ink-900 ring-1 ring-line placeholder:text-ink-500 hover:ring-line-strong active:bg-surface-pressed",
  sunken: "bg-surface-sunken text-ink-900 ring-1 ring-line placeholder:text-ink-600 hover:ring-line-strong active:bg-surface-pressed",
  dark: "bg-ink-900/60 text-white ring-1 ring-ink-700 placeholder:text-ink-400 hover:ring-ink-600 active:bg-ink-900",
};

/* The control shell, shared with the bare <select> on the cart page that cannot be an <Input>.
   Padding is left to the caller so a control can pick its own size without two competing
   padding utilities on one element (there is no tailwind-merge here). */
export const fieldClass =
  "rounded-control text-sm outline-none transition duration-fast ease-out " +
  "focus:ring-2 focus:ring-brand-700 motion-reduce:transition-none";

type Props = ComponentPropsWithoutRef<"input"> & { tone?: "light" | "sunken" | "dark" };

export default function Input({ tone = "light", className, ...rest }: Props) {
  return (
    <input
      className={cn(fieldClass, "w-full px-4 py-2.5", TONES[tone], className)}
      {...rest}
    />
  );
}
