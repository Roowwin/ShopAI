import { PageHeader } from "@/app/components/ui";
import GroupsPanel from "./GroupsPanel";
import { pageClass } from "@/lib/ui";

/* PRODUCT GROUPS - one image and one price per brand + model + grade.

   A shell, like every other admin page: the heading and the panel, and nothing else. Everything
   that reads or writes lives in GroupsPanel, which is a client component.

   THE HEADING IS `PageHeader` NOW. It used to be a tinted banner of its own, which is the one
   heading shape this app had that nothing else had - see PageHeader's own note on the five shapes it
   replaced. Inventory, which this screen now matches column for column, opens with the same
   primitive. */

export default function ProductGroupsPage() {
  return (
    <main className={pageClass.wide}>
      <PageHeader
        title="Product groups"
        description="One photograph and one price per model and grade, shared by every lot. Press a row to set them."
      />
      <GroupsPanel />
    </main>
  );
}
