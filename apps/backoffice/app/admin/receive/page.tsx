"use client";

/* Receiving stock: create a lot, scan units into it, or read one unit from a photograph.

   THIS PAGE EXISTS BECAUSE THE IMPORT PAGE WAS STRIPPED, NOT BECAUSE THE TOOLS WERE NEW. They used to
   sit at the foot of Product import, under the sheet importer, as "Photo intake" and "New lot".
   Product import is now the drop zone and the preview and nothing else - which is what "only two
   things on the page" has to mean - and these tools would have gone with it: they were rendered from
   that page and from nowhere else, so deleting the section would have deleted the application's only
   doors to `POST /staff/lots` (create a lot), `POST /staff/assets/scan-in` (one serial into one lot)
   and the AI photo intake. Three real capabilities, one door, and the door was the thing being
   removed.

   So they moved rather than went. Nothing about them changed: this file is a shell, exactly as the
   import page was a shell around the sheet panel. */

import { Heading } from "@/app/components/ui";
import IntakeTools from "@/app/admin/intake/IntakeTools";

export default function ReceiveStockPage() {
  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 pt-8 pb-16">
      <div>
        <Heading level="h1">Receive stock</Heading>
        <p className="mt-1 text-sm text-ink-500">
          Create a lot, scan a serial into it, or read one unit from a photograph. Stock is created
          deliberately: the lot comes first, then the units go into it.
        </p>
      </div>

      <IntakeTools />
    </main>
  );
}
