import { Badge, Card, Heading, Table, TBody, TD, TH, THead, TR } from "@/app/components/ui";

/* The recent-activity feed: the last 20 audit rows the API hands back, as a Table.

   Read-only on purpose - there is no refund and no delete anywhere in this app, and the audit
   log is append-only at the DB level (0001_initial revokes UPDATE/DELETE on it), so a row here
   can never be an action affordance. The actor is shown as its type plus id: the API's actor_id
   is a staff_users.id, which is what the audit trail itself records - resolving it to an email
   would be a second query per row, the N+1 this endpoint exists to avoid. */
type Entry = { at: string; actor_type: string; actor_id: number | null; entity: string; action: string; entity_id: number | null };

type Props = { entries: Entry[] };

function when(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" });
}

export default function AuditFeed({ entries }: Props) {
  return (
    <Card className="p-4">
      <Heading level="h3" as="h2" className="mb-2">Recent activity</Heading>
      <Table label="Recent audit activity">
        <THead>
          <TH>When</TH><TH>Actor</TH><TH>Entity</TH><TH>Action</TH>
        </THead>
        <TBody>
          {entries.map((e, i) => (
            <TR key={`${e.at}-${i}`}>
              <TD className="text-ink-500 whitespace-nowrap">{when(e.at)}</TD>
              <TD>
                <Badge colorClass="bg-surface-sunken text-ink-600">
                  {e.actor_type}{e.actor_id != null ? ` · ${e.actor_id}` : ""}
                </Badge>
              </TD>
              <TD className="font-mono text-xs text-ink-600">
                {e.entity}{e.entity_id != null ? ` #${e.entity_id}` : ""}
              </TD>
              <TD className="text-ink-900">{e.action}</TD>
            </TR>
          ))}
          {entries.length === 0 && (
            <TR><TD colSpan={4} className="text-ink-500">No audit activity yet.</TD></TR>
          )}
        </TBody>
      </Table>
    </Card>
  );
}
