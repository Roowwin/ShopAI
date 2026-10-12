import type { ComponentPropsWithoutRef } from "react";
import { cn } from "./cn";

/* light = the card fill, the default for form rows; sunken = the page ground itself, for a field that
   separates from a CARD rather than from the page; dark = the inverse fill, a well on a dark surface.
   All three carry a focus highlight, which the pre-design-system inputs did not.

   The placeholder tone is picked against the tone's OWN fill, and on a dark ground the steps run the
   other way: the card takes the middle ink (6.96:1), the raised band takes the stronger one (9.85:1),
   and the inverse fill takes the dim one (~5.8:1). All three clear 4.5:1 against the fill they sit on.

   The sunken tone has no call site in this app; it is kept in step with the storefront's header search.

   The dark tone's ring is a hairline like the other two: it used to be ink-700, which on the old
   palette was a subtle slate border and is now near-white - a 17:1 border on a near-black field. */
const TONES: Record<"light" | "sunken" | "dark", string> = {
  light: "bg-surface text-ink-900 ring-1 ring-line placeholder:text-ink-500",
  sunken: "bg-surface-sunken text-ink-900 ring-1 ring-line placeholder:text-ink-600",
  dark: "bg-ink-inverse/80 text-ink-900 ring-1 ring-line-strong placeholder:text-ink-400",
};

type Props = ComponentPropsWithoutRef<"input"> & { tone?: "light" | "sunken" | "dark" };

/* `py-2` = the backoffice's one 36px control height (text-sm's 20px line box + 8px either
   side), so an Input and a Button on the same row line up exactly. The storefront's roomier
   padding is tuned to its 44px touch control - see the comment in Button.tsx. */
export default function Input({ tone = "light", className, ...rest }: Props) {
  return (
    <input
      className={cn(
        "w-full rounded-control px-4 py-2 text-sm outline-none transition focus:ring-2 focus:ring-brand-700",
        TONES[tone],
        className,
      )}
      {...rest}
    />
  );
}
