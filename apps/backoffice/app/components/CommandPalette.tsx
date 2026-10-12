"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { flatNav } from "./nav";
import { cn } from "./ui";

/* The command palette: Cmd/Ctrl+K from anywhere in the admin, or the pill in the top strip.

   It is a FILTER over the sidebar's own GROUPS (app/components/nav.ts), not a second list of routes.
   The chrome's rule is that every entry has a page behind it, and a palette carrying its own copy of
   the thirteen would be free to break that rule unnoticed.

   Keyboard only, deliberately: the trigger is the shortcut's affordance, not its equal. Opening
   remembers where focus was and closing puts it back, because a palette that drops focus on the
   document strands anyone who opened it from the middle of a form. */
export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const box = useRef<HTMLDivElement | null>(null);
  const pill = useRef<HTMLButtonElement | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  const rows = useRef<(HTMLButtonElement | null)[]>([]);
  const router = useRouter();

  const all = useMemo(() => flatNav(), []);
  const hits = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (t === "") { return all; }
    return all.filter((h) => h.label.toLowerCase().includes(t) || h.heading.toLowerCase().includes(t));
  }, [q, all]);

  /* The shortcut is global, and it works whether or not the palette is already open - Cmd+K then
     Cmd+K again is the natural way to dismiss something that appeared by accident. */
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) { return; }
    const back = document.activeElement as HTMLElement | null;
    setQ(""); setI(0);
    input.current?.focus();
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) { setOpen(false); }
    };
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
      // Focus goes back where it came from - the pill if that is what opened this, otherwise wherever
      // the keyboard shortcut was pressed.
      (back ?? pill.current)?.focus?.();
    };
  }, [open]);

  // Keep the highlighted row on screen as the arrows walk past the fold.
  useEffect(() => { rows.current[i]?.scrollIntoView({ block: "nearest" }); }, [i, hits.length]);

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") { e.preventDefault(); setOpen(false); return; }
    if (hits.length === 0) { return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setI((v) => Math.min(v + 1, hits.length - 1)); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); setI((v) => Math.max(v - 1, 0)); return; }
    if (e.key === "Enter" && hits[i]) { e.preventDefault(); go(hits[i].href); }
  }

  return (
    <>
      <button
        ref={pill}
        type="button"
        onClick={() => setOpen(true)}
        aria-keyshortcuts="Control+K Meta+K"
        className={cn(
          "hidden md:inline-flex min-h-[36px] items-center gap-2 rounded-full px-4 text-sm text-ink-500 ring-1 ring-line",
          "w-72 max-w-full transition duration-fast ease-out hover:ring-line-strong hover:text-ink-600",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 motion-reduce:transition-none",
        )}
      >
        <span className="flex-1 text-left">Search or jump to...</span>
        <kbd className="rounded border border-line px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-ink-400">{"⌘"}K</kbd>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-surface-muted/70 px-4 pt-24 backdrop-blur-sm">
          <div ref={box} role="dialog" aria-modal="true" aria-label="Command palette"
            className="w-full max-w-xl overflow-hidden rounded-card bg-surface-glass/90 shadow-glow ring-1 ring-line backdrop-blur-md">
            <input
              ref={input}
              value={q}
              onChange={(e) => { setQ(e.target.value); setI(0); }}
              onKeyDown={onKeyDown}
              placeholder="Type a page, or part of one..."
              aria-label="Filter admin pages"
              aria-controls="palette-list"
              className="w-full bg-transparent px-5 py-4 text-sm text-ink-900 outline-none placeholder:text-ink-400"
            />
            <ul id="palette-list" role="listbox" aria-label="Admin pages" className="max-h-80 overflow-y-auto border-t border-line py-1">
              {hits.map((h, n) => (
                <li key={h.href}>
                  <button
                    type="button"
                    ref={(el) => { rows.current[n] = el; }}
                    role="option"
                    aria-selected={n === i}
                    onMouseEnter={() => setI(n)}
                    onClick={() => go(h.href)}
                    className={cn(
                      "flex w-full items-center gap-3 px-5 py-2.5 text-left text-sm",
                      "transition-colors duration-fast ease-out motion-reduce:transition-none",
                      n === i ? "bg-brand-50 text-brand-300" : "text-ink-600 hover:bg-surface-sunken",
                    )}
                  >
                    <span className="flex-1 truncate">{h.label}</span>
                    <span className="shrink-0 text-[10px] uppercase tracking-wider text-ink-400">{h.heading}</span>
                  </button>
                </li>
              ))}
              {hits.length === 0 && (
                <li className="px-5 py-6 text-center text-sm text-ink-500">Nothing matches that.</li>
              )}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
