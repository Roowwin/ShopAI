"use client";

/* The standalone Product import page.

   It is a SHELL around `ProductImportPanel` and nothing else, and it is now the import's ONLY
   door: this page and the Grading screen used to render the same panel as two entrances to one
   flow, and that screen is gone. So there is one implementation of the importer and one way in,
   which is the state this note used to argue for and had to settle for twice.

   THE PHOTO AND LOT TOOLS ARE GONE TOO, along with the screen they moved to. They used to render
   under the importer as "Photo intake" and "New lot"; they were moved out to /admin/receive rather
   than deleted, on the reasoning that this page was their only renderer and removing the section
   would remove the only doors to creating a lot and scanning a serial in. That reasoning held
   until the owner stopped using them: stock now arrives already graded on a supplier sheet, the
   importer creates the lots itself, and nothing in the app needed those doors. The ENDPOINTS are
   still there and still tested - this is a screen that went, not a capability - but no page leads
   to them. */

import { Heading } from "@/app/components/ui";
import ProductImportPanel from "./ProductImportPanel";
import { pageClass } from "@/lib/ui";

export default function ProductImportPage() {
  return (
    <main className={pageClass.wide}>
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
