"use client";

/* The standalone Product import page.

   It is a SHELL around `ProductImportPanel` and nothing else. The panel is the same component the
   stock pipeline renders at its Import stage (app/admin/intake/page.tsx), so there is one
   implementation of the importer and two doors to it - the sidebar entry an operator bookmarked,
   and the stage in the funnel. Two copies of a four-hundred-line flow would drift, and the one
   that drifted would be the one nobody was looking at. */

import { Heading } from "@/app/components/ui";
import IntakeTools from "@/app/admin/intake/IntakeTools";
import ProductImportPanel from "./ProductImportPanel";

export default function ProductImportPage() {
  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 pt-8 pb-16">
      <div>
        <Heading level="h1">Product import</Heading>
        <p className="mt-1 text-sm text-ink-500">
          Bring stock in: read a product stock sheet, or take one unit at a time from a photo and a
          serial. Reading a sheet writes nothing - creating stock takes a second, deliberate press.
        </p>
      </div>

      <ProductImportPanel />

      {/* The photo/scan and lot tools, moved here from Lot Process when that page became a
          grading workstation. */}
      <div className="border-t border-line pt-6">
        <IntakeTools />
      </div>
    </main>
  );
}
