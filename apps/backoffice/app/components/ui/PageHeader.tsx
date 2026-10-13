import type { ReactNode } from "react";
import Heading from "./Heading";
import { cn } from "./cn";

/* The top of every admin page, in one place.

   Before this the app had five different header shapes: a bare `Heading` with a sibling `<p>`, the
   same pair wrapped in a `<div>`, a heading inside a tinted banner, a back-link plus heading on the
   detail screens, and a hand-rolled `<header>` flex row on the two dashboard-style pages. The
   description drifted between `mt-1` and `mt-2`, between `text-ink-500` and `text-ink-600`, and on
   three pages there was no description at all - not a decision, just the page being written on a
   different day.

   It renders the description through ONE pair of values so a page cannot pick its own, and it gives
   page actions somewhere to live instead of being appended to whatever markup happened to be last.

   `actions` is the page's own controls - a Refresh, a New lot, a filter. They wrap rather than
   overflow, because the two longest headers here (Pick & Pack, Assets workbench) are read on a
   laptop as often as on a 27" screen.

   Deliberately NOT here: the document title (`<title>`, which is Next metadata) and the page
   container (the `max-w-*`/padding wrapper). Several pages still disagree about the container
   width; folding that in would silently re-lay-out every page in the app under cover of a header
   change, so it stays a separate decision. */
type Props = {
  title: ReactNode;
  description?: ReactNode;
  /** Right-aligned page controls. Wraps below the title on a narrow viewport. */
  actions?: ReactNode;
  /** `h2` for the rare page nested under another heading; the tag follows the level. */
  level?: "h1" | "h2";
  className?: string;
};

export default function PageHeader({ title, description, actions, level = "h1", className }: Props) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-4", className)}>
      <div className="min-w-0">
        <Heading level={level}>{title}</Heading>
        {description && <p className="mt-1 max-w-3xl text-sm text-ink-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
