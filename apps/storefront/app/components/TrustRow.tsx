import type { ReactNode } from "react";
import { cn } from "./ui/cn";

/* THE PROMISES THIS SHOP MAKES, in one place, because it makes them on two screens: the product
   page's buy panel (where a shopper is deciding) and the home page's introduction (where they are
   deciding whether this shop is for them at all). The wording is lifted from the FAQ and the returns
   page rather than invented - "12-month warranty" and "30 days from delivery" are the published
   terms, and "certified refurbished" is what the site already says about itself.

   EVERY ONE IS A LINK, because a claim a shopper cannot check is a claim they will discount. The
   product page passes three of them (it says shipping in the line above its button, where the price
   is); the home page passes all four.

   THERE IS NO BUY-NOW-PAY-LATER ITEM AND THERE MUST NOT BE. This platform has no such provider - the
   only one configured is a development stub - and a payment promise is not something a page may
   invent. The same rule governs the marks in the footer. */
export type Promise = { key: string; label: string; href?: string; icon: ReactNode };

export const PROMISES: Promise[] = [
  {
    key: "shipping",
    label: "Free tracked shipping",
    href: "/faq",
    icon: (<><path d="M2.5 6.5h8v6h-8z" /><path d="M10.5 9h3.2l2.8 2.6v.9h-6z" /><circle cx="5.5" cy="14.2" r="1.5" /><circle cx="13.5" cy="14.2" r="1.5" /></>),
  },
  {
    key: "returns",
    label: "30-day returns",
    href: "/returns",
    icon: (<path d="M4 8h9a4 4 0 1 1 0 8H7M4 8l3-3M4 8l3 3" />),
  },
  {
    key: "warranty",
    label: "12-month warranty",
    href: "/faq",
    icon: (
      <>
        <path d="M10 2.5 16.5 5v5c0 3.6-2.6 6.6-6.5 7.5C6.1 16.6 3.5 13.6 3.5 10V5L10 2.5Z" />
        <path d="m7.2 10 2 2 3.6-3.8" />
      </>
    ),
  },
  {
    key: "graded",
    label: "Certified refurbished",
    href: "/grades",
    icon: (
      <>
        <path d="M10 2.5 16.5 5v5c0 3.6-2.6 6.6-6.5 7.5C6.1 16.6 3.5 13.6 3.5 10V5L10 2.5Z" />
        <path d="M10 6.5v4M10 13.2v.3" />
      </>
    ),
  },
];

/** The promises named by `keys`, in the order this table lists them. */
export function promisesFor(keys: string[]): Promise[] {
  return PROMISES.filter((p) => keys.includes(p.key));
}

export default function TrustRow({ keys, className }: { keys: string[]; className?: string }) {
  return (
    <ul className={cn("grid gap-4 text-center", className)}>
      {promisesFor(keys).map((p) => {
        const inner = (
          <>
            <svg viewBox="0 0 20 20" className="h-5 w-5 text-brand-300" fill="none" stroke="currentColor"
              strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {p.icon}
            </svg>
            <span className="text-[11px] leading-tight text-ink-500">{p.label}</span>
          </>
        );
        return (
          <li key={p.key}>
            {p.href
              ? <a href={p.href} className="flex flex-col items-center gap-1.5 hover:text-ink-900">
                  <svg viewBox="0 0 20 20" className="h-5 w-5 text-brand-300" fill="none" stroke="currentColor"
                    strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    {p.icon}
                  </svg>
                  <span className="text-[11px] leading-tight text-ink-500 underline decoration-line-strong underline-offset-2">{p.label}</span>
                </a>
              : <span className="flex flex-col items-center gap-1.5">{inner}</span>}
          </li>
        );
      })}
    </ul>
  );
}
