import type { ReactNode } from "react";
import { cn } from "./cn";

/* One component, two deliberate shapes. The grade badge is a square identity tile on /grades
   and a small pill in the product page rows - that difference is intentional and named here
   rather than left as drift. */
type Props = {
  children: ReactNode;
  shape?: "pill" | "tile";
  /** Data-driven colour (grade pills) or a token pair like "bg-brand-50 text-brand-700". */
  colorClass?: string;
  className?: string;
};

const SHAPES: Record<"pill" | "tile", string> = {
  pill: "inline-flex items-center text-xs font-semibold rounded-full px-2 py-0.5",
  tile: "inline-flex items-center justify-center h-9 w-9 rounded-control text-sm font-semibold",
};

export default function Badge({ children, shape = "pill", colorClass, className }: Props) {
  return <span className={cn(SHAPES[shape], colorClass, className)}>{children}</span>;
}
