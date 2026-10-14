"use client";

import { PageHeader } from "@/app/components/ui";
import PhotoFolder from "../PhotoFolder";
import { pageClass } from "@/lib/ui";

/* THE PHOTO FOLDER, on a page of its own.

   It used to sit above the Product groups list as a card, which put the two halves of one job on one
   screen and made neither the subject: the list is a table of what needs deciding, and this is the
   one bulk act that feeds it. Separating them also gives the pool the room its thumbnail grid wants -
   a pool of three hundred photographs in a card above a table was a scroll before the work.

   NOTE ON THE ROUTE: this static segment sits beside `[id]`, and Next resolves a literal before a
   dynamic one, so /admin/product-groups/photos is this page and never a group called "photos". */

export default function PhotoFolderPage() {
  return (
    <main className={pageClass.wide}>
      <a href="/admin/product-groups" className="text-sm text-brand-300 hover:underline">
        &larr; Product groups
      </a>
      <div className="mt-4">
        <PageHeader
          title="Photo folder"
          description="Put a whole folder of photographs in at once. Nothing is attached here - each product group then offers the photo whose filename matches it, and you accept the ones you agree with."
        />
      </div>
      <div className="mt-4">
        <PhotoFolder />
      </div>
    </main>
  );
}
