import type { ComponentPropsWithoutRef } from "react";
import { cn } from "./cn";

/* light = white fill, the default for form rows; sunken = slate fill, for a field that sits on
   a white bar and needs the contrast; dark = a field on a dark surface. All three carry a focus
   highlight, which the pre-design-system inputs did not.

   The placeholder tone is chosen against the tone's OWN fill, so the dark field takes the
   lighter placeholder the two light fills cannot: the light fill needs the mid ink step
   (4.76:1 on white) and the dark fill takes the pale one (6.96:1 on the ink-900 it sits on).
   The pair used before was inverted and both were under 4.5:1 (2.56:1 light, 3.75:1 dark).
   KNOWN REMAINING GAP, left as decided rather than rounded away: the mid ink step on the
   slate sunken fill computes 4.34:1, under 4.5:1 - the paler steps are worse (2.34:1) and the
   next step up would clear at 6.92:1. No backoffice field uses the sunken tone today, so this
   is recorded rather than hidden, in the same spirit as the hairline-boundary exception. */
const TONES: Record<"light" | "sunken" | "dark", string> = {
  light: "bg-surface text-ink-900 ring-1 ring-line placeholder:text-ink-500",
  sunken: "bg-surface-sunken text-ink-900 ring-1 ring-line placeholder:text-ink-500",
  dark: "bg-ink-900/60 text-white ring-1 ring-ink-700 placeholder:text-ink-400",
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
