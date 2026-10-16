import { Card } from "./components/ui";

/* The route-level loading state for every server-rendered route in the storefront.

   There was none before this: every page under app/ is a server component that awaits
   `apiInternal`, and the app had no loading.tsx, error.tsx or not-found.tsx anywhere, so a slow
   catalogue response left the shopper on a blank white page with a working header and nothing
   under it.

   The shape is deliberately the shape of the pages it stands in for, and it has to be kept that
   way - it has now been wrong twice, once for each time the home page changed shape. First it drew
   a wide hero band, which the homepage had stopped having. Then it drew the catalogue's heading and
   filter row alone, which was right while the catalogue led and is wrong now that the home page
   opens on an introduction and a strip of category tiles. It draws BOTH: two lines of introduction,
   a five-up row of tiles (the category strip), and then the catalogue's heading, filter row and
   grid. On a category or search page the first two rows are simply a little more skeleton than
   that page has, which is a far smaller lie than a placeholder for content that is about to appear
   somewhere else on the screen.

   It is `aria-busy` with an sr-only live message rather than a pile of divs a screen reader would
   read as nothing.

   The pulse is `animate-pulse` with a `motion-reduce:animate-none` off-switch: a skeleton that
   keeps shimmering for someone who has asked for reduced motion is the one animation they
   explicitly opted out of. */
export default function Loading() {
  return (
    <main className="mx-auto max-w-6xl px-4 pt-16 pb-28" aria-busy="true">
      <span role="status" className="sr-only">Loading the page</span>

      <div className="animate-pulse motion-reduce:animate-none">
        {/* the introduction: a headline, a line of copy, and the promise row */}
        <div className="h-9 w-full max-w-2xl rounded bg-surface-sunken" />
        <div className="mt-4 h-4 w-full max-w-xl rounded bg-surface-sunken" />
        <div className="mt-8 grid max-w-3xl grid-cols-2 gap-4 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-10 rounded bg-surface-sunken" />
          ))}
        </div>

        {/* the category strip: a heading, then its five-up row of tiles */}
        <div className="mt-14 h-6 w-40 rounded bg-surface-sunken" />
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 rounded-card bg-surface-sunken" />
          ))}
        </div>

        {/* the catalogue: its heading, its filter row, then the grid of tiles */}
        <div className="mt-16 h-7 w-44 rounded bg-surface-sunken" />
        <div className="mt-5 flex flex-wrap gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-9 w-28 rounded-control bg-surface-sunken" />
          ))}
        </div>
        <div className="mt-8 grid grid-cols-2 gap-8 md:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
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
