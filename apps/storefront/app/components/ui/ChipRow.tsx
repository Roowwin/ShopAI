import Button from "./Button";
import { cn } from "./cn";

/* One filter row: a small label and its chips.

   Every row on the catalog - category, brand, grade, price, sort - is THIS component, so a chip
   looks and behaves the same wherever it appears and a new filter is a new ChipRow rather than a
   new hand-written row of buttons. The styling is the Button primitive's own: the selected chip is
   `primary` (the one emerald thing, which is what makes "selected" legible without a second colour)
   and every other chip is `secondary`.

   `value === null` is the row's "All" option - the caller passes it as an ordinary option, so a row
   that has no meaningful "All" can simply leave it out. Each chip is a toggle rather than a link
   (the URL is written by the caller's onChange), so the selected one is announced as pressed. */

type Option = { value: string | null; label: string };

type Props = {
  label: string;
  options: Option[];
  value: string | null;
  onChange: (value: string | null) => void;
  className?: string;
};

export default function ChipRow({ label, options, value, onChange, className }: Props) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <span className="w-full sm:w-24 shrink-0 text-eyebrow font-medium uppercase text-ink-400">{label}</span>
      {options.map((o) => (
        <Button
          key={o.value ?? "all"}
          size="sm"
          variant={o.value === value ? "primary" : "secondary"}
          pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </Button>
      ))}
    </div>
  );
}
