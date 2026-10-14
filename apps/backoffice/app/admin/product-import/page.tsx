"use client";

/* The standalone Product import page.

   It is a SHELL around `ProductImportPanel` and nothing else. The panel is the same component the
   stock pipeline renders at its Import stage (app/admin/intake/page.tsx), so there is one
   implementation of the importer and two doors to it - the sidebar entry an operator bookmarked,
   and the stage in the funnel. Two copies of a four-hundred-line flow would drift, and the one
   that drifted would be the one nobody was looking at.

   THE PHOTO AND LOT TOOLS ARE NO LONGER HERE. They were rendered under the importer as "Photo
   intake" and "New lot", which made this page two things rather than one and buried the sheet
   importer's own end - the preview - below a section about something else. They moved to
   /admin/receive rather than being deleted, because this page was their only renderer: removing the
   section would have removed the only doors to creating a lot, scanning a serial in, and reading a
   unit from a photograph. */

import { Heading } from "@/app/components/ui";
import ProductImportPanel from "./ProductImportPanel";

export default function ProductImportPage() {
  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 pt-8 pb-16">
      <div>
        <Heading level="h1">Product import</Heading>
        <p className="mt-1 text-sm text-ink-500">
          Read a product stock sheet and preview what it would write. Reading writes nothing -
          committing takes a second, deliberate press.
        </p>
      </div>

      <ProductImportPanel />
    </main>
  );
}
