import { Badge, Card, Heading, Table, TBody, TD, TH, THead, TR } from "@/app/components/ui";
import { MUTED_TONE } from "./tokens";

/* The recent-activity feed: the last 20 audit rows the API hands back, as a Table.

   Read-only on purpose - there is no refund and no delete anywhere in this app, and the audit
   log is append-only at the DB level (0001_initial revokes UPDATE/DELETE on it), so a row here
   can never be an action affordance. The actor is shown as its type plus id: the API's actor_id
   is a staff_users.id, which is what the audit trail itself records - resolving it to an email
   would be a second query per row, the N+1 this endpoint exists to avoid.

   Every cell's CONTENT styling lives on an inner span, never on the TD. TD carries only layout
   (its own px-3 py-2 align-middle plus whitespace-nowrap here): there is no tailwind-merge, so a
   colour class on the cell would append to the primitive's rather than replace it, and TD exposes
   no colour prop to replace it with. Keeping colour one level in is what makes TD's contract
   ("layout only") true rather than aspirational. */
type Entry = { at: string; actor_type: string; actor_id: number | null; entity: string; action: string; entity_id: number | null };

type Props = { entries: Entry[] };

function when(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" });
}

export default function AuditFeed({ entries }: Props) {
  return (
    <Card className="p-4">
      <Heading level="h2">Recent activity</Heading>
      <Table label="Recent audit activity">
        <THead>
          <TH>When</TH><TH>Actor</TH><TH>Entity</TH><TH>Action</TH>
        </THead>
        <TBody>
          {entries.map((e, i) => (
            <TR key={`${e.at}-${i}`}>
              <TD className="whitespace-nowrap">
                <span className="text-ink-500">{when(e.at)}</span>
              </TD>
              <TD>
                <Badge colorClass={MUTED_TONE}>
                  {e.actor_type}{e.actor_id != null ? ` · ${e.actor_id}` : ""}
                </Badge>
              </TD>
              <TD>
                <span className="font-mono text-xs text-ink-600">
                  {e.entity}{e.entity_id != null ? ` #${e.entity_id}` : ""}
                </span>
              </TD>
              <TD>
                <span className="text-ink-900">{e.action}</span>
              </TD>
            </TR>
          ))}
          {entries.length === 0 && (
            <TR><TD colSpan={4}><span className="text-ink-500">No audit activity yet.</span></TD></TR>
          )}
        </TBody>
      </Table>
    </Card>
  );
}
