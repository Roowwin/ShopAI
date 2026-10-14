"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { Badge, Button, Card, Heading, Input, PageHeader, Select, TBody, TD, TH, THead, TR, Table } from "@/app/components/ui";
import { kickerClass, pageClass } from "@/lib/ui";
import { requireRole, useMe } from "@/lib/session";

/* Agent identity rail (ADR 0007) + the grant ledger (ADR 0008): list, create, rotate, revoke, and
   per identity the grants that decide what it may execute - admin only.

   The print-once panel is the point of the identity half. A token is generated server-side and
   returned to this page exactly once; only its hash is kept, so a lost secret cannot be looked up.
   The panel therefore says so in words and offers a copy action, and it disappears as soon as the
   admin dismisses it (or starts another mint) - there is no "show it again".

   The grant half is the point of the autonomy half, and its shape is deliberate: creating a grant
   is NOT the same act as arming it. A new grant arrives disabled, so the two-step is visible in the
   UI rather than hidden behind a server default, and the class shown on every row comes from the
   server (`outward` = reaches the storefront - price, list) rather than from this page's opinion.
   Nothing here can widen what the rail can dispatch: the action list is served by the API. */

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

type Grant = {
  id: number;
  action: string;
  action_class: string;
  daily_cap: number;
  enabled: boolean;
  created_at: string;
  used_today: number | null;
  remaining_today: number | null;
};

type GrantableAction = { action: string; action_class: string };

type GrantPanel = {
  agent_id: number;
  grants: Grant[];
  grantable_actions: GrantableAction[];
  usage_date: string;
  cap_min: number;
  cap_max: number;
};

function when(iso: string | null): string {
  if (!iso) { return "-"; }
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" });
}

const STATE_TONE: Record<string, string> = {
  active: "bg-brand-100 text-brand-300",
  revoked: "bg-danger-50 text-danger-600",
  expired: "bg-surface-sunken text-ink-600",
};

/* The action class, in the same badge language as the identity state. `outward` is the one that
   reaches a customer - a price, a publication - so it is toned apart from the inventory class; the
   word itself carries the meaning, never the colour alone. */
const CLASS_TONE: Record<string, string> = {
  outward: "bg-accent-100 text-accent-700",
  inventory: "bg-brand-100 text-brand-300",
};

function stateOf(a: Agent): string {
  if (a.revoked_at) { return "revoked"; }
  return a.active ? "active" : "expired";
}

/* Today's usage against the cap, from the counter the execution path itself reserves against. A
   null `used_today` means the counter could not be read, and says so rather than showing a
   reassuring 0 - an unknown budget is not a full one. */
function usageText(g: Grant, usageDate: string): string {
  return g.used_today === null
    ? "today's usage unknown"
    : g.used_today + " of " + g.daily_cap + " used on " + usageDate;
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
  /* The grant panel is open for at most ONE identity at a time - the grants are what the admin is
     deciding about, and two half-read panels side by side invite a mis-click on the wrong agent. */
  const [panel, setPanel] = useState<GrantPanel | null>(null);
  const [capDraft, setCapDraft] = useState<Record<number, string>>({});
  const [newAction, setNewAction] = useState("");
  const [newCap, setNewCap] = useState("1");

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

  /* ---------------------------- grants ---------------------------- */

  async function loadGrants(agentId: number) {
    const j = await send("/staff/agents/" + agentId + "/grants", { method: "GET" }, "Could not load grants");
    if (j) { setPanel(j); }
  }

  async function toggleGrants(agentId: number) {
    if (panel?.agent_id === agentId) { setPanel(null); return; }
    setCapDraft({});
    const j = await send("/staff/agents/" + agentId + "/grants", { method: "GET" }, "Could not load grants");
    if (!j) { return; }
    setPanel(j);
    setNewAction(j.grantable_actions?.[0]?.action ?? "");
    setNewCap(String(j.cap_min ?? 1));
  }

  async function addGrant(agentId: number) {
    if (!newAction) { setMsg("choose an action to grant"); return; }
    const j = await send("/staff/agents/" + agentId + "/grants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: newAction, daily_cap: Number(newCap) }),
    }, "Could not create the grant");
    if (!j) { return; }
    setMsg("Grant recorded, still DISABLED. Enable it when this identity should execute the action.");
    await loadGrants(agentId);
  }

  async function toggleGrant(agentId: number, g: Grant) {
    const j = await send("/staff/agents/" + g.id, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !g.enabled }),
    }, "Could not change the grant");
    if (j) { await loadGrants(agentId); }
  }

  async function saveCap(agentId: number, g: Grant) {
    const j = await send("/staff/agents/" + g.id, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ daily_cap: Number(capDraft[g.id] ?? g.daily_cap) }),
    }, "Could not change the cap");
    if (j) {
      setCapDraft((d) => { const next = { ...d }; delete next[g.id]; return next; });
      await loadGrants(agentId);
    }
  }

  async function revokeGrant(agentId: number, g: Grant) {
    const j = await send("/staff/agents/" + g.id, { method: "DELETE" }, "Could not revoke the grant");
    if (j) {
      setMsg(j.note ?? "Grant revoked.");
      await loadGrants(agentId);
    }
  }

  return (
    <main className={pageClass.wide}>
      <PageHeader title="Agents"
        description="Machine identities for the assistant - created, rotated and revoked here." />
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
              <p className="text-sm text-brand-300 mt-1 mb-2">
                Copy this secret now. It is shown one time only: the server keeps a hash of it and never the
                secret itself, so nobody - this page included - can show it again. If it is lost, rotate the
                identity and the old secret stops working at once.
              </p>
              <code className="block bg-surface rounded-control p-3 text-xs break-all text-ink-900">{minted.token}</code>
              <div className="flex items-center gap-3 mt-3">
                <Button size="sm" onClick={copy}>{copied ? "Copied" : "Copy secret"}</Button>
                <Button size="sm" variant="muted" onClick={() => setMinted(null)}>Dismiss</Button>
                <span className="text-xs text-brand-300">expires {when(minted.expires_at)}</span>
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
                    <Fragment key={a.id}>
                      <TR>
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
                            <Button size="inline" variant="ghost" disabled={busy}
                                    onClick={() => toggleGrants(a.id)}>
                              {panel?.agent_id === a.id ? "Hide grants" : "Grants"}
                            </Button>
                            <Button size="inline" variant="ghost" disabled={busy || state === "revoked"} onClick={() => rotate(a.id)}>
                              Rotate
                            </Button>
                            <Button size="inline" variant="ghost" disabled={busy || state === "revoked"} onClick={() => revoke(a.id)}>
                              Revoke
                            </Button>
                          </span>
                        </TD>
                      </TR>
                      {panel?.agent_id === a.id && (
                        <TR>
                          <TD colSpan={5} className="bg-surface-sunken">
                            <span className={kickerClass}>Autonomy grants</span>
                            <p className="text-sm text-ink-600 mt-1">
                              A grant says which actions this identity may execute without a human
                              Confirm, and how many times a day. It only takes effect when the api
                              has AI_AUTONOMY=true AND the row below is enabled - with either one
                              off, the identity still proposes and a person confirms.
                            </p>
                            <p className="text-xs text-ink-500 mt-1">
                              Revoking or disabling stops the NEXT execution. It does not undo one
                              that already ran: a device already published stays published, and a
                              price already set stays set.
                            </p>

                            <div className="mt-3">
                              <Table label={"Grants for " + a.name}>
                                <THead>
                                  <TH>Action</TH><TH>Class</TH><TH>Daily cap</TH><TH>Today</TH><TH>State</TH>
                                </THead>
                                <TBody>
                                  {panel.grants.map((g) => (
                                    <TR key={g.id}>
                                      <TD className="font-medium">{g.action}</TD>
                                      <TD>
                                        <Badge colorClass={CLASS_TONE[g.action_class] ?? STATE_TONE.expired}>
                                          {g.action_class}
                                        </Badge>
                                      </TD>
                                      <TD>
                                        <span className="flex items-center gap-2">
                                          <div className="w-20">
                                            <Input value={capDraft[g.id] ?? String(g.daily_cap)}
                                                   aria-label={"Daily cap for " + g.action}
                                                   onChange={(e) => setCapDraft((d) => ({ ...d, [g.id]: e.target.value }))} />
                                          </div>
                                          <Button size="inline" variant="ghost" disabled={busy}
                                                  onClick={() => saveCap(a.id, g)}>
                                            Save
                                          </Button>
                                        </span>
                                      </TD>
                                      <TD className="text-ink-500">{usageText(g, panel.usage_date)}</TD>
                                      <TD>
                                        <span className="flex items-center gap-3">
                                          <Badge colorClass={g.enabled ? STATE_TONE.active : STATE_TONE.expired}>
                                            {g.enabled ? "enabled" : "disabled"}
                                          </Badge>
                                          <Button size="inline" variant="ghost" disabled={busy}
                                                  onClick={() => toggleGrant(a.id, g)}>
                                            {g.enabled ? "Disable" : "Enable"}
                                          </Button>
                                          <Button size="inline" variant="ghost" disabled={busy}
                                                  onClick={() => revokeGrant(a.id, g)}>
                                            Revoke
                                          </Button>
                                        </span>
                                      </TD>
                                    </TR>
                                  ))}
                                  {panel.grants.length === 0 && (
                                    <TR>
                                      <TD colSpan={5} className="text-ink-500">
                                        No grants: this identity proposes only, and a person confirms
                                        every action.
                                      </TD>
                                    </TR>
                                  )}
                                </TBody>
                              </Table>
                            </div>

                            <div className="flex flex-wrap items-center gap-3 mt-3">
                              <div className="w-56">
                                <Select value={newAction} aria-label="Action to grant"
                                        onChange={(e) => setNewAction(e.target.value)}>
                                  {panel.grantable_actions.map((x) => (
                                    <option key={x.action} value={x.action}>
                                      {x.action} ({x.action_class})
                                    </option>
                                  ))}
                                </Select>
                              </div>
                              <div className="w-24">
                                <Input value={newCap} aria-label="Daily cap for the new grant"
                                       onChange={(e) => setNewCap(e.target.value)} />
                              </div>
                              <Button onClick={() => addGrant(a.id)} disabled={busy}>Grant action</Button>
                              <span className="text-xs text-ink-500">
                                caps {panel.cap_min}-{panel.cap_max} a day; new grants start disabled
                              </span>
                            </div>
                          </TD>
                        </TR>
                      )}
                    </Fragment>
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
