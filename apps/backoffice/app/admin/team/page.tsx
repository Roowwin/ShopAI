"use client";

/* The Team page: who is on staff, what each of them may reach, and how to take it away.

   ROLE IS THE WHOLE AUTHORISATION SURFACE. Every `/staff/*` door re-reads `staff_users.role` per
   request, so the dropdown in this table is not a label - it is the control that decides whether the
   person beside you can price stock, publish to the shop, or administer the platform. That is why
   the change is written on selection rather than behind a Save: a role edit that is staged and
   abandoned is a permission that did or did not change, and nobody can tell which from the screen.

   THE THREE THINGS THIS PAGE REFUSES TO OFFER, because the server refuses them and a control that
   offers a refusal is a worse experience than a control that explains itself:

   * Your own row's role and status. An admin who demotes or suspends themselves loses the screen
     they are standing on, and the next request is a 403 from a page that cannot fix itself. The
     controls are disabled on your row with the reason, and `is_you` comes from the server so the
     page and the API agree by construction rather than by both computing the same comparison.
   * The last active admin. Computed here from the same roster the server sends, so the disabled
     state and the 409 are the same rule seen twice.
   * A password reset for yourself, for the reason above - a reset revokes the target's sessions, and
     the target would be you.

   THE ONE-TIME PASSWORD IS THE ONLY PLAINTEXT THIS PAGE EVER SHOWS, and it says so where it shows
   it. The reset returns it once; the row stores a hash; a reload cannot bring it back. So the notice
   is deliberately loud, deliberately sticky (it does not clear on a timer like the routine notices
   elsewhere in this app - clearing the only copy of a credential the operator has not written down
   yet would be the opposite of helpful), and it stays until the operator dismisses it or resets
   someone else.

   A ROLE CHANGE IS OPTIMISTIC AND ROLLS BACK. The select writes immediately; a refusal puts the
   previous value back and prints the server's own sentence. Leaving the new value on screen after a
   403 would show a permission the account does not have, which is the one lie this table must not
   tell. */

import { useCallback, useEffect, useState } from "react";

import {
  Badge, Button, Card, Heading, PageHeader, Select, Stat, Table, TBody, TD, TH, THead, TR, cn,
} from "@/app/components/ui";
import { apiFetch } from "@/lib/api";
import { when } from "@/lib/format";
import { requireRole, useMe } from "@/lib/session";
import { kickerClass } from "@/lib/ui";

type Member = {
  id: number;
  public_id: string;
  email: string;
  display_name: string;
  role: string;
  status: string;
  totp_enabled: boolean;
  sessions: number;
  created_at: string | null;
  is_you: boolean;
};

type Roster = { total: number; roles: string[]; members: Member[] };

/* What a one-time credential looks like while it is on screen. `email` is kept so the notice can
   name who it is for - two resets in a row must not leave the operator guessing which one they are
   reading. */
type Handover = { email: string; password: string; sessions_revoked: number };

const STATUS_TONE: Record<string, string> = {
  active: "bg-status-listed-soft text-status-listed-ink",
  suspended: "bg-danger-50 text-danger-600",
};

export default function TeamPage() {
  const { me, checked } = useMe();
  const allowed = requireRole(me, ["admin"]);

  const [roster, setRoster] = useState<Roster | null>(null);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const [handover, setHandover] = useState<Handover | null>(null);

  const load = useCallback(async () => {
    const r = await apiFetch("/staff/team");
    if (!r.ok) {
      setErr(r.status === 403 ? "admin role required" : `Could not read the team (${r.status})`);
      return;
    }
    const j: Roster = await r.json().catch(() => null as any);
    if (j) setRoster(j);
  }, []);

  useEffect(() => {
    if (!checked) return;
    if (!allowed) { setErr("admin role required"); return; }
    void load();
  }, [checked, allowed, load]);

  /* The server's error body is `{ detail: string }`; anything else is echoed by status so a proxy
     error page is not rendered as the platform's own sentence. */
  async function detail(r: Response, fallback: string): Promise<string> {
    const j: any = await r.json().catch(() => ({}));
    return typeof j?.detail === "string" ? j.detail : `${fallback} (${r.status})`;
  }

  async function setRole(m: Member, role: string) {
    if (!roster || role === m.role) return;
    const before = roster;
    setBusy(m.id); setErr(""); setMsg("");
    setRoster({ ...roster, members: roster.members.map((x) => (x.id === m.id ? { ...x, role } : x)) });
    try {
      const r = await apiFetch(`/staff/team/${m.id}/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      if (!r.ok) {
        setRoster(before);
        setErr(await detail(r, "the role change was refused"));
        return;
      }
      setMsg(`${m.email} is now ${role}.`);
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function setStatus(m: Member, status: string) {
    setBusy(m.id); setErr(""); setMsg("");
    try {
      const r = await apiFetch(`/staff/team/${m.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!r.ok) { setErr(await detail(r, "the status change was refused")); return; }
      const j: any = await r.json().catch(() => ({}));
      setMsg(status === "suspended"
        ? `${m.email} is suspended, and ${j.sessions_revoked ?? 0} live session(s) were signed out.`
        : `${m.email} can sign in again.`);
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function resetPassword(m: Member) {
    setBusy(m.id); setErr(""); setMsg(""); setHandover(null);
    try {
      const r = await apiFetch(`/staff/team/${m.id}/password-reset`, { method: "POST" });
      if (!r.ok) { setErr(await detail(r, "the reset was refused")); return; }
      const j: any = await r.json().catch(() => ({}));
      setHandover({ email: m.email, password: String(j.password ?? ""), sessions_revoked: j.sessions_revoked ?? 0 });
      await load();
    } finally {
      setBusy(null);
    }
  }

  if (!checked) {
    return <main className="mx-auto max-w-6xl px-4 pt-8 pb-16"><p className="text-sm text-ink-500">Loading...</p></main>;
  }
  if (!allowed) {
    return (
      <main className="mx-auto max-w-6xl px-4 pt-8 pb-16">
        <Card className="p-6">
          <Heading level="h3" as="h2">Team</Heading>
          <p className="mt-2 text-sm text-ink-500">
            Managing the team is an administrator's screen. Your role is {me?.role ?? "unknown"}.
          </p>
        </Card>
      </main>
    );
  }

  const members = roster?.members ?? [];
  const roles = roster?.roles ?? [];
  const activeAdmins = members.filter((m) => m.role === "admin" && m.status === "active").length;

  /* The one rule the table enforces on itself, matching the server's: the only active admin's role
     and status are not editable from here. `reason` is what the disabled control says instead of
     doing nothing. */
  function lockReason(m: Member): string {
    if (m.is_you) return "this is your own account - another admin must change it";
    if (m.role === "admin" && m.status === "active" && activeAdmins <= 1) {
      return "this is the last active admin";
    }
    return "";
  }

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 pt-8 pb-16">
      <PageHeader
        title={<>Team</>}
        description={
          <>
            Everyone who can sign in to this backoffice, what each of them may reach, and the two ways
            to take that away. A role change takes effect on the member's next request.
          </>
        }
      />

      {handover && (
        <div role="status" className="rounded-card bg-accent-100 p-4 ring-1 ring-accent-400">
          <p className="text-sm font-semibold text-accent-700">
            New password for {handover.email} - shown once
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <code className="rounded-control bg-surface px-3 py-2 font-mono text-sm text-ink-900">
              {handover.password}
            </code>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => { void navigator.clipboard?.writeText(handover.password).catch(() => {}); }}
            >
              Copy
            </Button>
            <Button variant="muted" size="sm" onClick={() => setHandover(null)}>Dismiss</Button>
          </div>
          <p className="mt-2 text-xs text-ink-600">
            Hand this to {handover.email} over a channel you trust. This page will not show it again,
            and the platform stores only a hash of it. Their {handover.sessions_revoked} live
            session(s) were signed out.
          </p>
        </div>
      )}

      {msg && <p className="text-sm text-brand-300">{msg}</p>}
      {err && <p className="text-sm text-danger-600">{err}</p>}

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Team" value={members.length} sub="accounts that can sign in" />
        <Stat label="Active admins" value={activeAdmins} sub="the role that administers the platform" />
        <Stat label="Suspended" value={members.filter((m) => m.status === "suspended").length}
              sub={members.some((m) => m.status === "suspended") ? "cannot sign in until reinstated" : "nobody is suspended"} />
      </div>

      <Card className="p-4">
        <Table label="Staff accounts">
          <THead>
            <TH>Member</TH>
            <TH>Role</TH>
            <TH>Status</TH>
            <TH>Sessions</TH>
            <TH>MFA</TH>
            <TH>Added</TH>
            <TH>Actions</TH>
          </THead>
          <TBody>
            {members.map((m) => {
              const lock = lockReason(m);
              const rowBusy = busy === m.id;
              return (
                <TR key={m.id}>
                  <TD>
                    <span className="font-medium text-ink-900">{m.display_name || m.email.split("@")[0]}</span>
                    {m.is_you && <Badge className="ml-2" colorClass="bg-surface-sunken text-ink-600">you</Badge>}
                    <div className="text-xs text-ink-500">{m.email}</div>
                  </TD>
                  <TD>
                    <Select
                      aria-label={`Role for ${m.email}`}
                      value={m.role}
                      disabled={rowBusy || !!lock}
                      title={lock || undefined}
                      onChange={(e) => { void setRole(m, e.target.value); }}
                      className={cn(lock && "opacity-60")}
                    >
                      {/* The member's current role may be one this build does not offer (a hand-set
                          row). It stays selectable so the select shows the truth rather than
                          silently reassigning them by rendering a different value. */}
                      {(roles.includes(m.role) ? roles : [m.role, ...roles]).map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </Select>
                  </TD>
                  <TD>
                    <Badge colorClass={STATUS_TONE[m.status] ?? "bg-surface-sunken text-ink-600"}>
                      {m.status}
                    </Badge>
                  </TD>
                  <TD className="text-ink-600">{m.sessions}</TD>
                  <TD className="text-ink-600">{m.totp_enabled ? "on" : <span className="text-ink-500">off</span>}</TD>
                  <TD className="text-ink-500">{m.created_at ? when(m.created_at) : "-"}</TD>
                  <TD>
                    <div className="flex flex-wrap items-center gap-2">
                      {/* The reason a control is disabled rides on the wrapper, not the Button:
                          the primitive takes no `title`, and a disabled control is not focusable,
                          so the sentence would otherwise be unreachable. */}
                      <span title={lock || undefined}>
                        <Button
                          variant="secondary" size="sm" disabled={rowBusy || !!lock}
                          onClick={() => { void resetPassword(m); }}
                        >
                          Reset password
                        </Button>
                      </span>
                      {m.status === "active" ? (
                        <span title={lock || undefined}>
                          <Button
                            variant="danger" size="sm" disabled={rowBusy || !!lock}
                            onClick={() => { void setStatus(m, "suspended"); }}
                          >
                            Suspend
                          </Button>
                        </span>
                      ) : (
                        <Button
                          variant="secondary" size="sm" disabled={rowBusy}
                          onClick={() => { void setStatus(m, "active"); }}
                        >
                          Reinstate
                        </Button>
                      )}
                    </div>
                  </TD>
                </TR>
              );
            })}
            {roster && members.length === 0 && (
              <TR><TD colSpan={7} className="text-ink-500">No staff accounts yet.</TD></TR>
            )}
          </TBody>
        </Table>

        <p className={cn(kickerClass, "mt-4 block")}>What the roles reach</p>
        <ul className="mt-2 space-y-1 text-sm text-ink-600">
          <li><span className="font-medium text-ink-900">admin</span> - everything, including this page and the agent identities.</li>
          <li><span className="font-medium text-ink-900">manager</span> - the inventory and commerce surfaces, minus team and platform administration.</li>
          <li><span className="font-medium text-ink-900">technician</span> - grading and unit intake.</li>
          <li><span className="font-medium text-ink-900">warehouse</span> - lots, scan-in, movement and listing.</li>
          <li><span className="font-medium text-ink-900">sales</span> - pricing and the storefront-facing surfaces.</li>
        </ul>
        <p className="mt-3 text-xs text-ink-500">
          A reset password is not shown again, and neither is a suspended account's access: both
          revoke the member's live sessions, so a session taken before the change does not outlive it.
        </p>
      </Card>
    </main>
  );
}
