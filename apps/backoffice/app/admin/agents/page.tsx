"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { Badge, Button, Card, Heading, Input, Select, Table, TBody, TD, TH, THead, TR } from "@/app/components/ui";
import { kickerClass } from "@/lib/ui";
import { requireRole, useMe } from "@/lib/session";

/* Agent identity rail (ADR 0007): list, create, rotate, revoke - admin only.

   The print-once panel is the point of this page. A token is generated server-side and returned to
   this page exactly once; only its hash is kept, so a lost secret cannot be looked up. The panel
   therefore says so in words and offers a copy action, and it disappears as soon as the admin
   dismisses it (or starts another mint) - there is no "show it again". */

type Agent = {
  id: number;
  name: string;
  scopes: string[];
  email: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  active: boolean;
};

type Minted = { id: number; token: string; expires_at: string };

function when(iso: string | null): string {
  if (!iso) { return "-"; }
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" });
}

const STATE_TONE: Record<string, string> = {
  active: "bg-brand-100 text-brand-900",
  revoked: "bg-danger-50 text-danger-600",
  expired: "bg-surface-sunken text-ink-600",
};

function stateOf(a: Agent): string {
  if (a.revoked_at) { return "revoked"; }
  return a.active ? "active" : "expired";
}

export default function AgentsPage() {
  const { me, checked } = useMe();
  const allowed = requireRole(me, ["admin"]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [name, setName] = useState("");
  const [ttl, setTtl] = useState("90");
  const [minted, setMinted] = useState<Minted | null>(null);
  const [msg, setMsg] = useState("");
  const [copied, setCopied] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await apiFetch("/staff/agents");
    if (!r.ok) {
      setMsg(r.status === 403 ? "admin role required" : "Could not load agent identities");
      setLoaded(true);
      return;
    }
    const j: any = await r.json().catch(() => ({}));
    setAgents(j.agents ?? []);
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!checked) { return; }
    if (!allowed) { setMsg("admin role required"); setLoaded(true); return; }
    void load();
  }, [checked, allowed, load]);

  async function send(path: string, init: RequestInit, failMsg: string): Promise<any | null> {
    setBusy(true); setMsg("");
    const r = await apiFetch(path, init);
    const j: any = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setMsg(j.detail ?? failMsg); return null; }
    return j;
  }

  async function create() {
    if (!name.trim()) { setMsg("give the identity a name"); return; }
    setCopied(false);
    const j = await send("/staff/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), ttl_days: Number(ttl) }),
    }, "Could not create the identity");
    if (!j) { return; }
    setMinted({ id: j.id, token: j.token, expires_at: j.expires_at });
    setName("");
    await load();
  }

  async function rotate(id: number) {
    setCopied(false);
    const j = await send("/staff/agents/" + id + "/rotate", { method: "POST" }, "Could not rotate");
    if (!j) { return; }
    setMinted({ id, token: j.token, expires_at: j.expires_at });
    await load();
  }

  async function revoke(id: number) {
    const j = await send("/staff/agents/" + id + "/revoke", { method: "POST" }, "Could not revoke");
    if (!j) { return; }
    setMinted(null);
    await load();
  }

  async function copy() {
    if (!minted) { return; }
    try {
      await navigator.clipboard.writeText(minted.token);
      setCopied(true);
    } catch {
      setMsg("copy refused by the browser - select the secret and copy it by hand before dismissing");
    }
  }

  return (
    <main className="max-w-6xl mx-auto p-4 min-h-screen">
      <div className="bg-ink-900 text-white rounded-card px-5 py-3 mb-4 flex items-center gap-3">
        <Heading level="h1">Agents</Heading>
        <span className="text-xs text-ink-400">machine identities for the assistant - created, rotated and revoked here</span>
      </div>
      {msg && (<div className="rounded-control bg-accent-100 text-accent-700 px-3 py-2 mb-3 text-sm">{msg}</div>)}

      {!allowed && (
        <Card className="p-4">
          <p className="text-sm text-ink-600">This page needs the admin role.</p>
        </Card>
      )}

      {allowed && (
        <div className="space-y-4">
          <Card className="p-4">
            <Heading level="h3" as="h2" className="mb-2">New identity</Heading>
            <div className="flex flex-wrap items-center gap-3">
              <div className="w-64">
                <Input placeholder="hermes-ops-1" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <Select value={ttl} onChange={(e) => setTtl(e.target.value)} aria-label="Token lifetime in days">
                <option value="30">30 days</option>
                <option value="90">90 days</option>
                <option value="180">180 days</option>
                <option value="365">365 days</option>
              </Select>
              <Button onClick={create} disabled={busy}>Create identity</Button>
            </div>
          </Card>

          {minted && (
            <Card tone="brand" className="p-4">
              <span className={kickerClass}>Shown once</span>
              <p className="text-sm text-brand-900 mt-1 mb-2">
                Copy this secret now. It is shown one time only: the server keeps a hash of it and never the
                secret itself, so nobody - this page included - can show it again. If it is lost, rotate the
                identity and the old secret stops working at once.
              </p>
              <code className="block bg-surface rounded-control p-3 text-xs break-all text-ink-900">{minted.token}</code>
              <div className="flex items-center gap-3 mt-3">
                <Button size="sm" onClick={copy}>{copied ? "Copied" : "Copy secret"}</Button>
                <Button size="sm" variant="muted" onClick={() => setMinted(null)}>Dismiss</Button>
                <span className="text-xs text-brand-900">expires {when(minted.expires_at)}</span>
              </div>
            </Card>
          )}

          <Card className="p-4">
            <div className="flex items-baseline justify-between mb-2">
              <Heading level="h3" as="h2">Identities</Heading>
              <span className="text-sm text-ink-500">{agents.length} total</span>
            </div>
            <Table label="Agent identities">
              <THead>
                <TH>Name</TH><TH>State</TH><TH>Created</TH><TH>Expires</TH><TH>Actions</TH>
              </THead>
              <TBody>
                {agents.map((a) => {
                  const state = stateOf(a);
                  return (
                    <TR key={a.id}>
                      <TD className="font-medium">{a.name}</TD>
                      <TD>
                        <Badge colorClass={STATE_TONE[state]}>{state}</Badge>
                        {/* The revocation time belongs with the state, not under the Expires
                            header: this identity keeps its original expiry date when it is
                            revoked, and the two are different facts. */}
                        {a.revoked_at && (
                          <span className="ml-2 text-xs text-ink-500">revoked {when(a.revoked_at)}</span>
                        )}
                      </TD>
                      <TD className="text-ink-500">{when(a.created_at)}</TD>
                      <TD className="text-ink-500">{when(a.expires_at)}</TD>
                      <TD>
                        <span className="flex items-center gap-3">
                          <Button size="inline" variant="ghost" disabled={busy || state === "revoked"} onClick={() => rotate(a.id)}>
                            Rotate
                          </Button>
                          <Button size="inline" variant="ghost" disabled={busy || state === "revoked"} onClick={() => revoke(a.id)}>
                            Revoke
                          </Button>
                        </span>
                      </TD>
                    </TR>
                  );
                })}
                {loaded && agents.length === 0 && !msg && (
                  <TR><TD colSpan={5} className="text-ink-500">No agent identities yet.</TD></TR>
                )}
              </TBody>
            </Table>
          </Card>
        </div>
      )}
    </main>
  );
}
