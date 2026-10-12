"use client";

/* THE STAFF WORKSTATION. One search box, one table. Nothing else lives here.

   This page used to be a four-stage "pipeline" with an import section, a stage strip and two
   not-built placeholders. All of that is gone, deliberately: a workstation is not a dashboard, and
   every element that is not the search or the work is something a grader has to read past on the
   way to grading. The rule this page now follows is that if it does not help grade a unit or
   document one, it is not on the page.

   WHERE THE OLD CONTENT WENT - nothing was deleted, it moved:

   * the product-sheet importer and the photo/scan/lot tools were the page's "Import" section.
     They now live on the Product import page (app/admin/product-import), which is the page about
     bringing stock in. Their internals are untouched.
   * the Price and List stages were placeholders for work that does not exist yet. They are gone
     from here entirely rather than left as boxes; the Asset Workbench still lists and prices.

   The work itself is `LotWorkbench`: the search, the lot-expanding resolution, the highlight, and
   the editable table. */

import { Heading } from "@/app/components/ui";
import LotWorkbench from "./LotWorkbench";

export default function LotProcessPage() {
  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 pt-8 pb-16">
      <div>
        <Heading level="h1">Lot Process</Heading>
        <p className="mt-1 text-sm text-ink-500">
          Search a lot, an asset id or a serial number, then grade the units and write up what you
          found. Every change saves as you make it.
        </p>
      </div>

      <LotWorkbench />
    </main>
  );
}
