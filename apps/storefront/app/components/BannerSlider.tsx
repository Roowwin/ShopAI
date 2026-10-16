"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { mediaUrl } from "@/lib/api";
import { cn } from "./ui/cn";

/* THE BANNERS, AS A SLIDER THAT MOVES BY ITSELF AND STOPS WHEN YOU TOUCH IT.

   WHY SCROLL-SNAP AND NOT A CAROUSEL LIBRARY. The slides are already a horizontal list; making them
   a scroller means a swipe on a phone, a trackpad flick on a laptop, the dots below, and the timer
   ALL move the same thing by the same mechanism, with no library, no transform bookkeeping and no
   state to get out of step with what is on screen. The component reads which slide is showing BACK
   from the scroller rather than deciding it, so a swipe it did not initiate cannot leave the dots
   lying about where the shopper is.

   IT STOPS FOR ANYONE WHO IS DOING SOMETHING: hovering, focusing a banner with the keyboard, or
   having asked their system for reduced motion. A banner that slides out from under a shopper's
   cursor is the single most disliked thing about carousels, and the audience that set
   `prefers-reduced-motion` is exactly the audience that does not want this at all.

   ONLY THE FIRST IMAGE LOADS EAGERLY. The others are `lazy`, and the slides that are off-screen are
   `aria-hidden` and untabbable, so a keyboard user tabbing through the page meets one banner link
   rather than three - the ones they cannot see are not in the tab order. */
export type Banner = { url: string; href: string; alt: string };

/* How long a banner stays up before the next one slides in. THREE SECONDS, at the owner's request
   (it was 6.5). That is brisk for a banner carrying a headline, a sub-line, three benefit chips and a
   button - a shopper who reads slowly will meet the next one mid-sentence - but it is one constant,
   and the timer stops the moment they hover, focus or touch, so nobody is racing it. */
const INTERVAL_MS = 3000;

export default function BannerSlider({ banners }: { banners: Banner[] }) {
  const track = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  const goTo = useCallback((n: number) => {
    const el = track.current;
    if (!el) return;
    el.scrollTo({ left: n * el.clientWidth, behavior: "smooth" });
  }, []);

  /* Which slide is showing, read back from the scroller. rAF-coalesced: a flick fires dozens of
     scroll events and each one would otherwise be a state update and a re-render. */
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const w = el.clientWidth || 1;
        setActive(Math.min(banners.length - 1, Math.max(0, Math.round(el.scrollLeft / w))));
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => { el.removeEventListener("scroll", onScroll); cancelAnimationFrame(raf); };
  }, [banners.length]);

  useEffect(() => {
    if (paused || banners.length < 2) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // Re-armed on every change, so a manual swipe buys a full interval before the next move rather
    // than being cut off by a timer that was already part-way through.
    const t = window.setInterval(() => goTo((active + 1) % banners.length), INTERVAL_MS);
    return () => window.clearInterval(t);
  }, [active, paused, banners.length, goTo]);

  return (
    <section className="max-w-6xl mx-auto px-4 pt-6" aria-label="Current offers">
      <div
        ref={track}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocusCapture={() => setPaused(true)}
        onBlurCapture={() => setPaused(false)}
        onTouchStart={() => setPaused(true)}
        className={cn(
          "flex snap-x snap-mandatory overflow-x-auto scroll-smooth rounded-card",
          "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        )}
      >
        {banners.map((b, n) => (
          <a key={b.url} href={b.href} aria-hidden={n !== active} tabIndex={n === active ? 0 : -1}
            className={cn(
              "w-full shrink-0 snap-center overflow-hidden rounded-card ring-1 ring-line",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700",
            )}>
            {/* eslint-disable-next-line @next/next/no-img-element -- the shop's own origin, not a remote asset */}
            <img src={mediaUrl(b.url)} alt={b.alt} width={2048} height={768}
              loading={n === 0 ? "eager" : "lazy"} fetchPriority={n === 0 ? "high" : "auto"}
              decoding="async" className="aspect-[8/3] w-full object-cover" />
          </a>
        ))}
      </div>

      {banners.length > 1 && (
        <div className="mt-3 flex items-center justify-center gap-2">
          {banners.map((b, n) => (
            <button key={b.url} type="button" onClick={() => goTo(n)}
              aria-label={"Show offer " + (n + 1) + " of " + banners.length}
              aria-current={n === active}
              className={cn(
                "h-2 w-2 rounded-full transition-colors duration-fast ease-out motion-reduce:transition-none",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2",
                n === active ? "bg-brand-700" : "bg-line-strong hover:bg-ink-300",
              )} />
          ))}
        </div>
      )}
    </section>
  );
}
