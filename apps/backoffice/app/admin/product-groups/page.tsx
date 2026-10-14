import { Heading } from "@/app/components/ui";
import GroupsPanel from "./GroupsPanel";

/* PRODUCT GROUPS - one image and one price per brand + model + grade.

   A shell, like every other admin page: the heading and the panel, and nothing else. Everything
   that reads or writes lives in GroupsPanel, which is a client component. */

export default function ProductGroupsPage() {
  return (
    <main className="mx-auto max-w-7xl px-4 pt-8 pb-16">
      <div className="bg-surface-muted text-ink-900 rounded-card px-5 py-3 mb-4 flex items-center gap-3">
        <Heading level="h1">Product groups</Heading>
        <span className="text-xs text-ink-400">
          one image and one price per model and grade, shared by every lot
        </span>
      </div>
      <GroupsPanel />
    </main>
  );
}
