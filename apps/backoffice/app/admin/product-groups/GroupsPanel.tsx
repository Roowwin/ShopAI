"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { aud } from "@/lib/format";
import { Button, Card, Input, Select, Stat, Table, TBody, TD, TH, THead, TR, cn } from "@/app/components/ui";
import { kickerClass } from "@/lib/ui";
import { stateBadge, type Group } from "./shared";

/* THE GROUP WORKLIST: one image and one price per model and grade.

   THE SAME SHAPE AS INVENTORY, deliberately. Both screens answer "what have I got and what still
   needs doing", and an operator who has learned one should not have to learn the other: a count of
   what matches, a filter bar whose options carry their own counts, a table, and a row that opens the
   thing itself. What this one lists is a MODEL+GRADE rather than a unit, because that is the level
   the decision is made at.

   THE EDITING IS ON THE ROW'S OWN PAGE NOW. This was a list beside a 360px pane that held the
   photograph, the price suggestions and the publish button; the table is the list, and a row opens
   /admin/product-groups/{id} where the photograph gets the room to be judged and the price gets its
   working printed beside it. Nothing else changed about how a price is set: suggestions fill the box,
   Save is the only write, and publishing refuses a group nobody has priced.

   THE FOLDER IS ITS OWN PAGE TOO. It is the one bulk act that feeds this list, and it was crowding
   the top of it - see photos/page.tsx. */

const STATE_TABS = [
  { key: "needs_setup", label: "Needs setup" },
  { key: "ready", label: "Ready" },
  { key: "live", label: "Live" },
  { key: "", label: "All" },
] as const;

export default function GroupsPanel() {
  const router = useRouter();
  const [state, setState] = useState<string>("needs_setup");
  const [term, setTerm] = useState("");
  /* One category, by SLUG, because that is what survives a rename and what the server matches on
     alongside the name. `""` is "every category". */
  const [cat, setCat] = useState("");
  const [groups, setGroups] = useState<Group[]>([]);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async (nextState: string, nextTerm: string, nextCat: string) => {
    const qs = new URLSearchParams();
    if (nextState) qs.set("state", nextState);
    if (nextTerm.trim()) qs.set("q", nextTerm.trim());
    if (nextCat) qs.set("category", nextCat);
    qs.set("limit", "200");
    const r = await apiFetch("/staff/product-groups?" + qs.toString());
    if (!r.ok) {
      setErr(r.status === 403 ? "admin or manager role required" : "could not load product groups");
      setLoaded(true);
      return;
    }
    setErr("");
    setGroups(await r.json());
    setLoaded(true);
  }, []);

  /* THE FILTER'S OWN OPTIONS COME FROM THE SERVER, not from the rows on screen: the list is filtered
     and capped at 200, so deriving them here would drop every category the current filter has hidden
     - and the one an operator most wants to switch to is exactly the one they cannot currently see. */
  const [cats, setCats] = useState<{ name: string; slug: string; groups: number }[]>([]);
  useEffect(() => {
    void (async () => {
      const r = await apiFetch("/staff/product-groups/categories");
      if (!r.ok) return;
      const j: any = await r.json().catch(() => ({}));
      setCats(j.categories ?? []);
    })();
  }, []);

  useEffect(() => { void load(state, term, cat); }, [state, cat, load]); // eslint-disable-line react-hooks/exhaustive-deps

  const counts = useMemo(() => ({
    units: groups.reduce((n, g) => n + g.units_total, 0),
    listed: groups.reduce((n, g) => n + g.units_listed, 0),
    priced: groups.filter((g) => g.price_override !== null).length,
  }), [groups]);

  async function publishAllSetUp() {
    setErr(""); setMsg("");
    const r = await apiFetch("/staff/product-groups/publish", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ only_published: true }),
    });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) { setErr(typeof j.detail === "string" ? j.detail : "that publish was refused"); return; }
    const t = j.totals ?? {};
    const hidden = t.units_hidden_below_cost ?? 0;
    setMsg(`${t.units_listed ?? 0} unit${t.units_listed === 1 ? "" : "s"} published to the storefront.`
      + (hidden > 0 ? ` ${hidden} of them are priced below cost, so the shop will not show them.` : ""));
    await load(state, term, cat);
  }

  if (!loaded) {
    return <Card className="p-4 text-sm text-ink-500">Loading product groups…</Card>;
  }

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-2">
        {STATE_TABS.map((t) => (
          <button key={t.key} type="button" onClick={() => setState(t.key)}
            aria-pressed={state === t.key}
            className={cn("min-h-[36px] rounded-control px-3 text-sm font-semibold transition",
              "motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700",
              state === t.key ? "bg-brand-700 text-white" : "bg-surface-sunken text-ink-600 hover:ring-1 hover:ring-line-strong")}>
            {t.label}
          </button>
        ))}
        {/* Widths go on WRAPPERS, never on Input or Select: both carry `w-full` in their base and this
            app has no tailwind-merge, so a caller's width class loses to it by stylesheet order. */}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Select value={cat} aria-label="Filter by category"
            onChange={(e) => setCat(e.target.value)}>
            <option value="">Every category</option>
            {cats.map((c) => (
              <option key={c.slug} value={c.slug}>{c.name} ({c.groups})</option>
            ))}
          </Select>
          <div className="w-56">
            <Input value={term} placeholder="brand or model" aria-label="Search groups"
              onChange={(e) => setTerm(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { void load(state, term, cat); } }} />
          </div>
          <Button variant="secondary" size="sm" onClick={() => void load(state, term, cat)}>Search</Button>
          <Button variant="secondary" size="sm" href="/admin/product-groups/photos">Photo folder</Button>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <Stat label="Groups" value={groups.length} />
        <Stat label="Priced" value={counts.priced} sub={"of " + groups.length} />
        <Stat label="Units" value={counts.units} sub={counts.listed + " on the shop"} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={() => void publishAllSetUp()}>
          Publish remaining units for set-up groups
        </Button>
        <p className="text-xs text-ink-500">
          Publishes only groups already in the storefront, reusing the image and price they have.
        </p>
      </div>

      {msg && <p className="mt-3 text-sm text-brand-300">{msg}</p>}
      {err && <p className="mt-3 text-sm text-danger-600">{err}</p>}

      <div className="mt-4">
        <Table label="Product groups">
          <THead>
            <TH>Brand</TH>
            <TH>Model</TH>
            <TH>Category</TH>
            <TH>Grade</TH>
            <TH className="text-right">On shop</TH>
            <TH className="text-right">Price</TH>
            <TH>State</TH>
          </THead>
          <TBody>
            {groups.map((g) => {
              const badge = stateBadge(g.state);
              const href = "/admin/product-groups/" + g.id;
              return (
                <TR key={g.id} tabIndex={0}
                  onClick={() => router.push(href)}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget) { return; }
                    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); router.push(href); }
                  }}
                  className={cn("cursor-pointer transition-colors duration-fast ease-out",
                    "hover:bg-surface-muted motion-reduce:transition-none",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-700")}>
                  <TD className="text-ink-600">{g.brand}</TD>
                  <TD className="truncate font-display text-ink-900">{g.model}</TD>
                  {/* A group spanning two categories says so with a count rather than picking one,
                      because picking one would be the app inventing a fact. */}
                  <TD className="text-ink-600">
                    {g.categories.length === 0 ? "-" : g.categories[0]}
                    {g.categories.length > 1 && <span className="text-ink-400"> +{g.categories.length - 1}</span>}
                  </TD>
                  <TD><span className="font-semibold text-ink-700">{g.grade}</span></TD>
                  <TD className="text-right text-ink-600">{g.units_listed}/{g.units_total}</TD>
                  <TD className="text-right">
                    {g.price_override === null
                      ? <span className="text-ink-500">not set</span>
                      : aud(g.price_override)}
                  </TD>
                  <TD>
                    <span className={cn("inline-flex items-center text-xs font-semibold rounded-full px-2 py-0.5", badge.cls)}>
                      {badge.text}
                    </span>
                  </TD>
                </TR>
              );
            })}
            {groups.length === 0 && (
              <TR>
                <TD colSpan={7} className="py-6 text-center text-sm text-ink-500">
                  {/* Two different facts, and saying the wrong one sends the operator looking for
                      groups that exist. */}
                  {state === "needs_setup"
                    ? "Every model and grade on this filter has been set up."
                    : "No group matches these filters."}
                </TD>
              </TR>
            )}
          </TBody>
        </Table>
      </div>

      <p className={cn("mt-3 text-xs text-ink-500")}>
        Groups are declared by a product import - import a sheet and every brand + model + grade on it
        appears here, waiting for a photograph and a price. Press a row to give it both.
      </p>
    </Card>
  );
}
