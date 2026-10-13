"use client";

import { useEffect } from "react";
import { Button, Card, Heading, linkClass } from "./components/ui";

/* The storefront's error boundary.

   `apiInternal` THROWS on any non-OK response and most callers do not wrap it, so before this
   file a single 5xx from the catalogue took the whole route down to Next's unstyled development
   overlay (and, in production, to a bare "Application error"). The shopper's header and footer
   survived, which made it look like the shop was up with nothing in it.

   `reset` re-runs the failed segment's render, which is the right retry here: these failures are
   almost always a transient upstream hiccup, and nothing on the page has been mutated.

   The error's own message is NOT rendered. It is upstream text ("upstream 503") that means
   nothing to a shopper, and echoing raw exception text into the page is how internal detail ends
   up on a storefront. It goes to the console for whoever is debugging. */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  /* In an effect, not during render: a render-phase side effect runs twice under StrictMode and
     would log the same failure twice. */
  useEffect(() => { console.error(error); }, [error]);

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <Card className="p-8 text-center">
        <Heading level="h1">Something went wrong</Heading>
        <p className="mt-3 text-body text-ink-600">
          We could not load this page just now. This is usually brief - try again, and if it keeps
          happening please <a href="/contact" className={linkClass}>tell us what you were looking at</a>.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Button onClick={reset}>Try again</Button>
          <Button variant="secondary" href="/">Back to the shop</Button>
        </div>
      </Card>
    </main>
  );
}
