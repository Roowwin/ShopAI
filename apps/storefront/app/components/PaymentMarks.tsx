import type { ReactNode } from "react";

/* THE MARKS A SHOP PUTS IN ITS FOOTER - and the rule that governs them: EVERY MARK IS A CLAIM.
   A Visa mark says "we take Visa". This platform settles through PAYMENT_PROVIDER, which is a
   development stub today, so the list below is the shop the owner is launching rather than what
   this build can do - his call, made with that written down beside it. Two things follow:

     * Do not add a method the platform cannot settle. A mark for a card you cannot charge is the
       kind of thing a consumer regulator reads as misleading conduct, and no shopper can tell the
       difference from the outside.
     * Do not add a buy-now-pay-later mark at all. There is no such provider in this platform, and
       the product page's own trust row carries a comment saying the same thing for the same reason.

   THESE ARE DRAWN, NOT THE BRANDS' OWN ARTWORK. Visa, Mastercard, Amex and PayPal each publish the
   mark you are required to use, with rules about clear space and colour - Mastercard's two
   overlapping circles are not a decoration to be recoloured. What is below is recognisable and
   deliberately plain; replace it with the provider's asset kit (every real provider ships one)
   before launch. PayPal in particular has a two-tone wordmark that is flattened to one colour here.

   THE COLOURS ARE THE BRANDS', NOT THE DESIGN SYSTEM'S, and that is the one exception in this app:
   these are other people's trademarks, not the shop's palette, and a greyscale Visa mark is not the
   Visa mark. Everything around them - the chip, the hairline, the band - is the design system's. */

const CHIP = "inline-flex h-7 w-12 shrink-0 items-center justify-center rounded-[4px] bg-white ring-1 ring-line";

type Mark = { name: string; node: ReactNode };

const MARKS: Mark[] = [
  { name: "Visa", node: <span className="text-[11px] font-bold italic tracking-tight text-[#1A1F71]">VISA</span> },
  { name: "Mastercard", node: (
      <svg viewBox="0 0 30 18" className="h-[18px] w-[30px]" aria-hidden="true">
        <circle cx="11.5" cy="9" r="7" fill="#EB001B" />
        <circle cx="18.5" cy="9" r="7" fill="#F79E1B" />
        <path d="M15 3.6a7 7 0 0 0 0 10.8 7 7 0 0 0 0-10.8Z" fill="#FF5F00" />
      </svg>) },
  { name: "American Express", node: (
      <span className="inline-flex h-7 w-12 items-center justify-center rounded-[4px] bg-[#2E77BC]">
        <span className="text-[8px] font-bold leading-none tracking-wider text-white">AMEX</span>
      </span>) },
  { name: "PayPal", node: <span className="text-[11px] font-bold italic tracking-tight text-[#003087]">PayPal</span> },
  { name: "Apple Pay", node: (
      <span className="inline-flex items-center gap-1 text-ink-900">
        <svg viewBox="0 0 16 20" className="h-[14px] w-[11px]" fill="currentColor" aria-hidden="true">
          <path d="M11.2 10.6c0-2.2 1.8-3.3 1.9-3.4-1-1.5-2.6-1.7-3.2-1.7-1.4-.1-2.6.8-3.3.8-.7 0-1.7-.8-2.8-.8-1.4 0-2.8.8-3.5 2.1-1.5 2.6-.4 6.5 1.1 8.6.7 1 1.5 2.2 2.6 2.1 1-.1 1.4-.7 2.7-.7s1.6.7 2.7.7c1.1 0 1.8-1 2.5-2.1.8-1.2 1.1-2.3 1.1-2.4 0 0-2.1-.8-2.1-3.2ZM9.1 4.1c.6-.7 1-1.7.9-2.7-.9 0-2 .6-2.6 1.3-.6.6-1 1.6-.9 2.6 1 .1 2-.5 2.6-1.2Z" />
        </svg>
        <span className="text-[11px] font-semibold">Pay</span>
      </span>) },
  { name: "Google Pay", node: (
      <span className="text-[11px] font-semibold tracking-tight">
        <span className="text-[#4285F4]">G</span><span className="text-[#5F6368]"> Pay</span>
      </span>) },
];

export default function PaymentMarks() {
  return (
    <ul className="flex flex-wrap items-center gap-2" aria-label="Payment methods accepted">
      {MARKS.map((m) => (
        <li key={m.name} className={CHIP}>
          {/* The mark itself is decorative to a screen reader; the name beside it is the information.
              Without this the row announces as a list of unreadable fragments. */}
          <span className="sr-only">{m.name}</span>
          <span aria-hidden="true" className="flex items-center justify-center">{m.node}</span>
        </li>
      ))}
    </ul>
  );
}
