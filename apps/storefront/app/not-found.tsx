import { Button, Card, Heading } from "./components/ui";

/* The not-found page.

   It backs two different situations and is worded for both, because it cannot tell them apart:

   1. An unmatched URL - the shopper mistyped, or followed a stale link.
   2. `notFound()` from the product page. That route calls it when the slug returns 404, which in
      this catalogue is the normal end state for a product whose last unit sold: the endpoint
      stops listing it rather than returning an empty one. "This product is no longer available"
      is the truthful reading of that, and it is the case a shopper actually hits, so the copy
      leads with it rather than with "404".

   Deliberately no search box: the header already carries one on every route this renders under,
   and a second one two inches below the first is worse than none. */
export default function NotFound() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <Card className="p-8 text-center">
        <Heading level="h1">We could not find that page</Heading>
        <p className="mt-3 text-body text-ink-600">
          The link may be out of date, or the product may have sold out - this shop lists each
          device once, so a product page disappears when its last unit goes.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Button href="/">Browse the shop</Button>
          <Button variant="secondary" href="/search">Search the catalogue</Button>
        </div>
      </Card>
    </main>
  );
}
