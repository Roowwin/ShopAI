import type { ComponentPropsWithoutRef } from "react";
import { cn } from "./cn";

/* light = the glass field, for an input sitting on a card (cart, assistant, checkout). sunken =
   the recessed fill, for the header search, which sits on the transparent header bar and needs to
   read as a well rather than as another panel. deep = the deepest step, for a field on a
   deliberately deep band (the footer's newsletter).
   All three carry a focus highlight.

   Every field also gets a hover hairline (the boundary firms up before you click into it) and a
   pressed fill, both from tokens. A field does not take the Button's 1px sink - a text box that
   shifts under the cursor is a usability defect, not a state - so `active:` here is the darker
   shade on its own. */
const TONES: Record<"light" | "sunken" | "deep", string> = {
  light: "bg-surface text-ink-900 ring-1 ring-line placeholder:text-ink-500 hover:ring-brand-500 active:bg-surface-pressed",
  sunken: "bg-surface-sunken text-ink-900 ring-1 ring-line placeholder:text-ink-500 hover:ring-brand-500 active:bg-surface-pressed",
  deep: "bg-surface-deep/60 text-ink-900 ring-1 ring-line placeholder:text-ink-400 hover:ring-brand-500 active:bg-surface-deep",
};

/* The control shell, shared with a bare <select> that cannot be an <Input>. The focus ring is
   brand-300: this app is dark on every page, and brand-700 - the fill - is 2.3:1 as a ring here.
   Padding is left to the caller so a control can pick its own size without two competing
   padding utilities on one element (there is no tailwind-merge here). */
export const fieldClass =
  "rounded-control text-sm outline-none transition duration-fast ease-out " +
  "focus:ring-2 focus:ring-brand-300 motion-reduce:transition-none";

type Props = ComponentPropsWithoutRef<"input"> & { tone?: "light" | "sunken" | "deep" };

export default function Input({ tone = "light", className, ...rest }: Props) {
  return (
    <input
      className={cn(fieldClass, "w-full px-4 py-2.5", TONES[tone], className)}
      {...rest}
    />
  );
}
