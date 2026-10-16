import type { ReactNode } from "react";
import { cn } from "./cn";

/* An empty screen, in one sentence plus whatever the shopper can DO about it.

   THE `action` SLOT IS THE POINT OF THIS COMPONENT NOW. Every empty state in the shop - the cart,
   the search, the filtered grid, the account - was one line of small grey text on an otherwise blank
   page, which reads as a page that failed rather than a shop that has nothing to show here yet. The
   pages that can offer a next step (browse the shop, clear the filters, search again) pass one; the
   ones that cannot pass nothing and get exactly the line they had before. */
type Props = {
  children?: ReactNode;
  className?: string;
  action?: ReactNode;
};

export default function EmptyState({ children, className, action }: Props) {
  return (
    <div className={cn("text-sm text-ink-500", className)}>
      <p>{children}</p>
      {action && <div className="mt-4 flex flex-wrap items-center gap-3">{action}</div>}
    </div>
  );
}
