"use client";

import { cn } from "./cn";

/* THE SWITCH. A two-state control that saves itself: the CMS sets a flag and the press IS the
   write, so this primitive owns the state it is in and nothing else - no form, no Save button, and
   no `name`/`value` for a form to collect.

   WHY A BUTTON, NOT A CHECKBOX. The control the CMS shipped for "featured" was a raw checkbox. A
   checkbox is a form control: it reports its state to whatever submits the form, and the CMS had a
   Save button to do the submitting. With the write moved onto the press there is no form left, and
   what remains is a button whose state the server owns - which is exactly what `role="switch"` with
   `aria-checked` describes. A screen reader announces it as a switch that is on or off, and a
   keyboard user presses Space or Enter to flip it, the same as the button it actually is.

   THE LABEL IS REQUIRED AND IS NOT DRAWN. Every call site puts the switch in a row whose own text
   names it ("Featured", "Active"), and the visible text is not programmatically tied to the
   control - so the name has to come from here. A switch with no accessible name announces as
   "switch, on", which is a control nobody can use.

   THE TWO STATES ARE TWO FILLS, measured against the dark ground rather than chosen by eye: off is
   the sunken well with a hairline and the mid ink for its knob, on is the deep emerald step, which
   is the one step that carries a white knob at 5.4:1. The bright emerald would have put the knob at
   2.4:1, under the 3:1 a non-text control needs.

   No width/height utility appears in these comments on purpose: Tailwind scans source text, so a
   utility spelled out in prose emits a real rule into the built CSS. */
type Props = {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** The control's accessible name - the row's own text is not tied to it programmatically. */
  label: string;
  disabled?: boolean;
  className?: string;
};

export default function Switch({ checked, onChange, label, disabled, className }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "inline-flex items-center rounded-full p-0.5 outline-none transition-colors",
        "duration-fast ease-out motion-reduce:transition-none",
        "focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2",
        "disabled:opacity-50 disabled:pointer-events-none",
        checked ? "bg-brand-700" : "bg-surface-sunken ring-1 ring-line-strong",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "block h-5 w-5 rounded-full transition-transform duration-fast ease-out motion-reduce:transition-none",
          checked ? "translate-x-5 bg-white" : "translate-x-0 bg-ink-500",
        )}
      />
    </button>
  );
}
