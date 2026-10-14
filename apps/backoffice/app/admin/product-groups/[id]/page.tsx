"use client";

import { useParams } from "next/navigation";

import GroupDetail from "./GroupDetail";
import { pageClass } from "@/lib/ui";

/* One model+grade. A shell, like every other page here: the way back, and the detail itself.

   THE ID COMES FROM THE ROUTE rather than from a query string, which is what lets a group be linked
   to, bookmarked and reloaded - the side pane this replaced could only be reached by pressing a row
   on the list. */

export default function GroupDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params?.id);
  if (!Number.isInteger(id) || id <= 0) {
    return <main className={pageClass.narrow}>
      <p className="text-sm text-ink-500">That is not a product group id.</p>
    </main>;
  }
  return (
    <main className={pageClass.narrow}>
      <a href="/admin/product-groups" className="text-sm text-brand-300 hover:underline">
        &larr; Product groups
      </a>
      <div className="mt-4">
        <GroupDetail groupId={id} />
      </div>
    </main>
  );
}
