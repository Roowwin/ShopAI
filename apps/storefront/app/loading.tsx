import { Card } from "./components/ui";

/* The route-level loading state for every server-rendered route in the storefront.

   There was none before this: every page under app/ is a server component that awaits
   `apiInternal`, and the app had no loading.tsx, error.tsx or not-found.tsx anywhere, so a slow
   catalogue response left the shopper on a blank white page with a working header and nothing
   under it.

   The shape is deliberately the shape of the pages it stands in for - a wide hero band over a
   four-up product grid - so the swap to real content does not move anything. It is `aria-busy`
   with an sr-only live message rather than a pile of divs a screen reader would read as nothing.

   The pulse is `animate-pulse` with a `motion-reduce:animate-none` off-switch: a skeleton that
   keeps shimmering for someone who has asked for reduced motion is the one animation they
   explicitly opted out of. */
export default function Loading() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-10" aria-busy="true">
      <span role="status" className="sr-only">Loading the page</span>

      <div className="animate-pulse motion-reduce:animate-none">
        {/* the hero band */}
        <div className="rounded-card bg-surface-sunken h-56 md:h-72" />

        {/* a section heading, then the grid of tiles */}
        <div className="mt-10 h-6 w-48 rounded bg-surface-sunken" />
        <div className="mt-5 grid grid-cols-2 gap-8 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="overflow-hidden">
              <div className="aspect-[4/3] bg-surface-sunken" />
              <div className="p-5">
                <div className="h-3 w-20 rounded bg-surface-sunken" />
                <div className="mt-3 h-4 w-4/5 rounded bg-surface-sunken" />
                <div className="mt-4 h-4 w-16 rounded bg-surface-sunken" />
              </div>
            </Card>
          ))}
        </div>
      </div>
    </main>
  );
}
