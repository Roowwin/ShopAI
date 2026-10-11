import type { ReactNode } from "react";
import { cn } from "./cn";

type Props = {
  children?: ReactNode;
  className?: string;
};

export default function EmptyState({ children, className }: Props) {
  return <p className={cn("text-sm text-ink-500", className)}>{children}</p>;
}
