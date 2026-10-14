"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { aud } from "@/lib/format";
import { requireRole, useMe } from "@/lib/session";
import { Button, Card, Input, Select, Stat, cn } from "@/app/components/ui";
import { kickerClass, linkClass } from "@/lib/ui";
import PhotoFolder from "./PhotoFolder";

/* THE GROUP WORKLIST: one image and one price per model and grade.

   WHAT THIS SCREEN IS FOR, in the operator's words: "I've imported the Excel, every row is already
   graded. From here I only need to give each model+grade a picture and a price, once." So this page
   is that worklist and nothing else - the set of decisions not yet taken, sorted so the ones that
   need attention come first.

   PRICE IS TYPED, NEVER APPLIED. The three quick-fill buttons put a NUMBER IN THE BOX. They do not
   save, they do not publish, and nothing else on this page reads them. Save is a separate press and
   it is the only thing that writes `price_override` (see the door's own docstring). That split is
   why the buttons can be generous with what they offer: FMV and Resale disagree by an order of
   magnitude on this data ($71 vs $732 on average), so a suggestion that wrote itself would be a
   pricing decision made by nobody.

   WHY THERE IS A HIGHEST/MEDIAN/AVERAGE PICKER UNDER THE FMV BUTTON. One price per group only works
   if the group agrees, and on the imported data 284 of 295 groups hold more than one distinct FMV -
   one keyboard's Grade A range runs $10.06 to $69.75. The picker is the operator choosing WHICH
   summary they are accepting, which is a smaller question than the price itself and a much easier
   one to answer than "type a number". Median is the default because one outlier drags that
   keyboard's average from $69.75 down to $48.91.

   A PHOTOGRAPH IS ATTACHED TO THE GROUP, so there is no "apply to all units" step: every lot of that
   model and grade is already reading the same row. Upload is the whole action. */

type Group = {
  id: number; brand: string; model: string; grade: string;
  state: "needs_setup" | "ready" | "live";
  storefront_id: string | null; product_id: number | null;
  media_id: number | null; image_url: string | null;
  price_override: number | null; price_source: string | null;
  published_at: string | null;
  units_total: number; units_listed: number;
  basis_max: number | null; fmv_variants: number;
  below_cost_if_priced_here: boolean;
  /* Usually one. A group is keyed on brand+model+grade and not on the category, so a model whose
     Category was spelled two ways on two sheets sits in two categories under one group. */
  categories: string[];
};

type Detail = Group & {
  aggregates: {
    units_total: number; units_listed: number; units_publishable: number;
    fmv: { min: number | null; max: number | null; avg: number | null; median: number | null; variants: number };
    resale: { min: number | null; max: number | null; avg: number | null; median: number | null; variants: number };
    basis: { min: number | null; max: number | null };
    target_markup_pct: number;
  };
};

const STATE_TABS = [
  { key: "needs_setup", label: "Needs setup" },
  { key: "ready", label: "Ready" },
  { key: "live", label: "Live" },
  { key: "", label: "All" },
] as const;

/* Which of the three summaries a quick-fill button reads. `median` is first because it is the
   default and the reason the picker exists. */
const BASIS = [
  { key: "median", label: "Median" },
  { key: "max", label: "Highest" },
  { key: "avg", label: "Average" },
] as const;

type BasisKey = (typeof BASIS)[number]["key"];

function stateBadge(state: Group["state"]) {
  if (state === "live") return { text: "Live", cls: "bg-status-listed-soft text-status-listed-ink" };
  if (state === "ready") return { text: "Ready", cls: "bg-status-graded-soft text-status-graded-ink" };
  return { text: "Needs setup", cls: "bg-status-received-soft text-status-received-ink" };
}

export default function GroupsPanel() {
  const { me, checked } = useMe();
  const allowed = requireRole(me, ["admin", "manager"]);

  const [state, setState] = useState<string>("needs_setup");
  const [term, setTerm] = useState("");
  /* One category, by SLUG, because that is what survives a rename and what the server matches on
     alongside the name. `""` is "every category", which is the state the screen opens in. */
  const [cat, setCat] = useState("");
  const [groups, setGroups] = useState<Group[]>([]);
  const [openId, setOpenId] = useState<number | null>(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [loaded, setLoaded] = useState(false);

  /* The confirmation is the same `role="status"` toast the grading workbench uses - an announcement
     rather than an interruption, because publishing is a press an operator makes while looking at a
     list, and a toast that took focus would move them off their place in it. */
  const [toast, setToast] = useState<{ text: string; detail?: string } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(t);
  }, [toast]);

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

  /* THE FILTER'S OWN OPTIONS COME FROM THE SERVER, not from the rows on screen: the list is
     filtered and capped at 200, so deriving them here would drop every category the current filter
     has hidden - and the one an operator most wants to switch to is exactly the one they cannot
     currently see. Read once; it changes only when the catalogue does. */
  const [cats, setCats] = useState<{ name: string; slug: string; groups: number }[]>([]);
  useEffect(() => {
    if (!checked || !allowed) return;
    void (async () => {
      const r = await apiFetch("/staff/product-groups/categories");
      if (!r.ok) return;
      const j: any = await r.json().catch(() => ({}));
      setCats(j.categories ?? []);
    })();
  }, [checked, allowed]);

  useEffect(() => {
    if (!checked) return;
    if (!allowed) { setErr("admin or manager role required"); setLoaded(true); return; }
    void load(state, term, cat);
  }, [checked, allowed, state, cat, load]); // eslint-disable-line react-hooks/exhaustive-deps

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
    setToast({
      text: `${t.units_listed ?? 0} unit${t.units_listed === 1 ? "" : "s"} published to the storefront.`,
      detail: (t.units_hidden_below_cost ?? 0) > 0
        ? `${t.units_hidden_below_cost} of them are priced below cost, so the shop will not show them.`
        : undefined,
    });
    await load(state, term, cat);
  }

  if (!checked || !loaded) {
    return <Card className="p-4 text-sm text-ink-500">Loading product groups…</Card>;
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
      <div className="min-w-0">
        {/* THE FOLDER COMES FIRST, because it is the first thing an operator with a folder of
            photographs should do and everything below it is the consequence. */}
        <div className="mb-4">
          <PhotoFolder />
        </div>
        <Card className="p-4">
          <div className="flex flex-wrap items-center gap-2">
            {STATE_TABS.map((t) => (
              <button key={t.key} type="button" onClick={() => { setState(t.key); setOpenId(null); }}
                aria-pressed={state === t.key}
                className={cn("min-h-[36px] rounded-control px-3 text-sm font-semibold transition",
                  "motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700",
                  state === t.key ? "bg-brand-700 text-white" : "bg-surface-sunken text-ink-600 hover:ring-1 hover:ring-line-strong")}>
                {t.label}
              </button>
            ))}
            {/* The width is on a WRAPPER, not on the Input. Input's own base carries `w-full` and this
                app has no tailwind-merge, so a caller's `w-48` would lose to it by stylesheet order -
                see cn.ts and Select.tsx, which document the same trap. */}
            <div className="ml-auto flex items-center gap-2">
              {/* THE CATEGORY FILTER. Options are only the categories that hold a group, and each
                  carries its count, so the operator can see where the work is before choosing. */}
              <Select value={cat} aria-label="Filter by category"
                onChange={(e) => { setCat(e.target.value); setOpenId(null); }}>
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
        </Card>

        <Card className="mt-4 p-4">
          {groups.length === 0 ? (
            <p className="text-sm text-ink-500">
              Nothing here. Groups are declared by a product import - import a sheet and every
              brand + model + grade on it appears in this list.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {groups.map((g) => {
                const badge = stateBadge(g.state);
                return (
                  <li key={g.id}>
                    <button type="button" onClick={() => setOpenId(g.id === openId ? null : g.id)}
                      aria-expanded={g.id === openId}
                      className={cn("w-full text-left flex items-center gap-3 py-3 rounded-control transition",
                        "hover:bg-surface-muted motion-reduce:transition-none",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700")}>
                      <div className="min-w-0 flex-1">
                        {/* The category rides the kicker with the brand, because that is the pair
                            an operator is matching against a mental list of what they stock. A group
                            spanning two categories says so with a count rather than picking one. */}
                        <p className={kickerClass}>
                          {g.brand}
                          {g.categories.length > 0 && (
                            <span className="text-ink-400">
                              {" · "}{g.categories[0]}
                              {g.categories.length > 1 ? ` +${g.categories.length - 1}` : ""}
                            </span>
                          )}
                        </p>
                        <p className="text-sm font-medium text-ink-900 truncate">{g.model}</p>
                      </div>
                      <span className="shrink-0 text-sm font-semibold text-ink-700">Grade {g.grade}</span>
                      <span className="shrink-0 text-xs text-ink-500 w-24 text-right">
                        {g.units_listed}/{g.units_total} on shop
                      </span>
                      <span className="shrink-0 text-sm w-24 text-right">
                        {g.price_override === null ? <span className="text-ink-400">no price</span> : aud(g.price_override)}
                      </span>
                      <span className={cn("shrink-0 inline-flex items-center text-xs font-semibold rounded-full px-2 py-0.5", badge.cls)}>
                        {badge.text}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <div className="lg:sticky lg:top-6">
        {openId === null ? (
          <Card className="p-4 text-sm text-ink-500">
            Pick a row to give it an image and a price.
          </Card>
        ) : (
          <GroupEditor key={openId} groupId={openId}
            onSaved={() => void load(state, term, cat)} onToast={setToast} />
        )}
      </div>

      {toast && (
        <div role="status"
          className="fixed bottom-4 right-4 z-40 max-w-sm rounded-card bg-surface-glass/95 p-4 ring-1 ring-line backdrop-blur-md">
          <p className="text-sm text-ink-900">{toast.text}</p>
          {toast.detail && <p className="mt-1 text-xs text-ink-500">{toast.detail}</p>}
          <button type="button" onClick={() => setToast(null)} className={cn("mt-2 text-xs", linkClass)}>
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}

/* One pooled photograph as a thumbnail. Same discipline as the group's own preview below: the
   public `/media/...` address does not exist on the admin host, so the bytes come through the
   authenticated raw door into an object URL - revoked when the tile goes, or a scroll through a
   folder's worth of suggestions leaks one blob each. */
function SuggestedThumb({ rawPath }: { rawPath: string }) {
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    let made = "";
    apiFetch(rawPath).then(async (r) => {
      if (!r.ok) { if (alive) setFailed(true); return; }
      const b = await r.blob();
      if (!alive) return;
      made = URL.createObjectURL(b);
      setUrl(made);
    }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; if (made) URL.revokeObjectURL(made); };
  }, [rawPath]);
  if (failed || !url) {
    return <span className="h-12 w-16 shrink-0 rounded-control bg-surface-sunken ring-1 ring-line" aria-hidden="true" />;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a blob: URL, not a remote asset
    <img src={url} alt="" className="h-12 w-16 shrink-0 rounded-control object-cover ring-1 ring-line" />
  );
}

function GroupEditor({ groupId, onSaved, onToast }: {
  groupId: number;
  onSaved: () => void;
  onToast: (t: { text: string; detail?: string }) => void;
}) {
  const [d, setD] = useState<Detail | null>(null);
  const [price, setPrice] = useState("");
  const [source, setSource] = useState<string>("custom");
  const [basis, setBasis] = useState<BasisKey>("median");
  const [belowCost, setBelowCost] = useState(0);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [thumb, setThumb] = useState<string | null>(null);
  const [photoVersion, setPhotoVersion] = useState(0);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    const r = await apiFetch(`/staff/product-groups/${groupId}`);
    if (!r.ok) { setErr("could not load that group"); return; }
    const j: Detail = await r.json();
    setD(j);
    setPrice(j.price_override === null ? "" : String(j.price_override));
    setSource(j.price_source ?? "custom");
    setBelowCost(0);
  }, [groupId]);

  useEffect(() => { void load(); }, [load]);

  /* THE THUMBNAIL GOES THROUGH THE AUTHENTICATED DOOR AND IS TURNED INTO A BLOB URL. The public
     `/media/...` address the shop uses would resolve against the ADMIN host here, which does not
     serve that prefix - the tile would be a broken image on a screen whose whole job is to show the
     operator the photograph they are about to publish. The object URL is revoked when it is
     replaced, or the tab leaks one blob per upload. */
  useEffect(() => {
    if (!d || !d.image_url) { setThumb(null); return; }
    let url: string | null = null;
    let dead = false;
    void (async () => {
      const r = await apiFetch(`/staff/product-groups/${groupId}/image/raw`);
      if (!r.ok || dead) return;
      url = URL.createObjectURL(await r.blob());
      if (dead) { URL.revokeObjectURL(url); return; }
      setThumb(url);
    })();
    return () => { dead = true; if (url) URL.revokeObjectURL(url); };
  }, [groupId, d, photoVersion]);

  /* WHAT THE APP THINKS THIS GROUP'S PHOTOGRAPH IS. A READ, and only ever a read: the ranked list
     arrives, a person looks at the pictures and presses once for the one they want. Nothing on this
     path writes, which is the whole design - see `group_image_match.py` for why this app will not
     attach a shopper's product photo on its own judgement.
     Re-read whenever the pool changes, because accepting one photograph takes it out of the pool
     and the next-best suggestion is now the first one. */
  const [suggested, setSuggested] = useState<{ media_id: number; filename: string; raw_path: string; grade_marker: string | null }[]>([]);
  const [showAll, setShowAll] = useState(false);
  useEffect(() => {
    let dead = false;
    void (async () => {
      const r = await apiFetch(`/staff/product-groups/${groupId}/image-suggestions`);
      if (!r.ok || dead) return;
      const j: any = await r.json().catch(() => ({}));
      setSuggested(j.suggestions ?? []);
    })();
    return () => { dead = true; };
  }, [groupId, photoVersion]);

  async function attach(mediaId: number) {
    setErr(""); setMsg(""); setBusy(true);
    try {
      const r = await apiFetch(`/staff/product-groups/${groupId}/image/attach`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ media_id: mediaId }),
      });
      const j: any = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(typeof j.detail === "string" ? j.detail : "that image was refused"); return; }
      setMsg("Image attached to this model and grade - every lot of it uses it now.");
      setShowAll(false);
      setPhotoVersion((v) => v + 1);
      await load();
      onSaved();
    } catch {
      setErr("that image could not be attached");
    } finally {
      setBusy(false);
    }
  }

  async function savePrice() {
    setErr(""); setMsg("");
    const v = price.trim();
    const cents = Number(v);
    if (v === "" || !Number.isInteger(cents) || cents < 0) {
      setErr("the price has to be a whole number of cents, zero or more.");
      return;
    }
    setBusy(true);
    try {
      const r = await apiFetch(`/staff/product-groups/${groupId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ price_override: cents, price_source: source }),
      });
      const j: any = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(typeof j.detail === "string" ? j.detail : "that price was refused"); return; }
      setBelowCost(j.units_below_cost ?? 0);
      setMsg(`Saved ${aud(cents)} (${j.price_source}).`);
      await load();
      onSaved();
    } catch {
      setErr("that price could not be sent");
    } finally {
      setBusy(false);
    }
  }

  /* THE QUICK FILLS. Each one puts a number in the box and nothing else - no request is made, the
     row is not touched, and until Save is pressed the group has no opinion about its price. */
  function fillFrom(which: "fmv" | "resale" | "markup") {
    setErr(""); setMsg("");
    if (!d) return;
    const agg = d.aggregates;
    const base = which === "resale" ? agg.resale[basis] : agg.fmv[basis];
    if (base === null || base === undefined) {
      setErr(`this group has no ${which === "resale" ? "Resale" : "FMV"} value to suggest from.`);
      return;
    }
    const cents = which === "markup"
      ? Math.round(base * (1 + agg.target_markup_pct / 100))
      : base;
    setPrice(String(cents));
    setSource(which === "resale" ? "resale" : which === "markup" ? "fmv" : "fmv");
    setMsg(`Filled with ${aud(cents)} - press Save to confirm.`);
  }

  async function upload(file: File) {
    setErr(""); setMsg(""); setBusy(true);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const r = await apiFetch(`/staff/product-groups/${groupId}/image`, { method: "POST", body: fd });
      const j: any = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(typeof j.detail === "string" ? j.detail : "that image was refused"); return; }
      setMsg("Image attached to this model and grade - every lot of it uses it now.");
      setPhotoVersion((v) => v + 1);
      await load();
      onSaved();
    } catch {
      setErr("that image could not be sent");
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    setErr(""); setMsg(""); setBusy(true);
    try {
      const r = await apiFetch(`/staff/product-groups/${groupId}/publish`, { method: "POST" });
      const j: any = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(typeof j.detail === "string" ? j.detail : "that publish was refused"); return; }
      const missing: string[] = [];
      if ((j.hidden_below_cost ?? 0) > 0) missing.push(`${j.hidden_below_cost} priced below cost (the shop hides those)`);
      if (!j.has_image) missing.push("no image yet");
      onToast({
        text: `${j.listed} unit${j.listed === 1 ? "" : "s"} published for ${j.model} / Grade ${j.grade}.`,
        detail: missing.length ? "Not showing: " + missing.join(", ") + "." : undefined,
      });
      await load();
      onSaved();
    } catch {
      setErr("that publish could not be sent");
    } finally {
      setBusy(false);
    }
  }

  if (!d) return <Card className="p-4 text-sm text-ink-500">Loading…</Card>;

  const agg = d.aggregates;
  const badge = stateBadge(d.state);
  const canPublish = d.price_override !== null && agg.units_publishable > 0;

  return (
    <Card className="p-4">
      <p className={kickerClass}>{d.brand}</p>
      <h2 className="text-h3 font-semibold text-ink-900">{d.model}</h2>
      <div className="mt-1 flex items-center gap-2">
        <span className="text-sm font-semibold text-ink-700">Grade {d.grade}</span>
        <span className={cn("inline-flex items-center text-xs font-semibold rounded-full px-2 py-0.5", badge.cls)}>
          {badge.text}
        </span>
      </div>
      <p className="mt-1 text-xs text-ink-500">
        {agg.units_listed} of {agg.units_total} units on the shop
        {agg.units_publishable > 0 ? `, ${agg.units_publishable} waiting` : ""}
      </p>

      {/* THE PHOTOGRAPH. One per model and grade: attaching it here is what every lot of that
          model+grade reads, so there is no second "apply" step. */}
      <div className="mt-4">
        <p className={kickerClass}>Image</p>
        <div className="mt-2 flex items-start gap-3">
          <div className="h-20 w-28 shrink-0 rounded-control bg-surface-sunken ring-1 ring-line overflow-hidden flex items-center justify-center">
            {thumb
              ? <img src={thumb} alt="" className="h-full w-full object-cover" />
              : <span className="text-xs text-ink-400">{d.image_url ? "…" : "none"}</span>}
          </div>
          <div>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />
            <Button size="sm" variant="secondary" disabled={busy}
              onClick={() => fileRef.current?.click()}>
              {d.image_url ? "Replace image" : "Upload image"}
            </Button>
            <p className="mt-1 text-xs text-ink-500">JPEG, PNG, WebP or GIF, up to 5 MB.</p>
          </div>
        </div>

        {/* THE SUGGESTION, from the folder that was uploaded. It is OFFERED and never applied: the
            button beside it is the only thing that attaches anything, and it belongs to whoever is
            looking at the picture. The matched words are printed with it so the offer can be
            argued with rather than taken on faith - "matched on latitude, 5420" is a reason, and an
            unexplained thumbnail is not.
            ABSENT WHEN THERE IS NOTHING TO OFFER. A strip showing a weak guess would be worse than
            no strip at all: the operator would learn to ignore it, and then to ignore the good ones. */}
        {suggested.length > 0 && (
          <div className="mt-3 rounded-control bg-surface-muted p-3 ring-1 ring-line">
            <p className="text-xs font-semibold text-ink-900">
              In the folder you uploaded
            </p>
            <ul className="mt-2 space-y-2">
              {(showAll ? suggested : suggested.slice(0, 1)).map((s) => (
                <li key={s.media_id} className="flex items-center gap-2">
                  <SuggestedThumb rawPath={s.raw_path} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[11px] text-ink-600" title={s.filename}>{s.filename}</p>
                    <p className="text-[10px] text-ink-500">
                      {s.grade_marker ? `grade ${s.grade_marker} in the name` : "no grade in the name"}
                    </p>
                  </div>
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => void attach(s.media_id)}>
                    Use this photo
                  </Button>
                </li>
              ))}
            </ul>
            {suggested.length > 1 && (
              <button type="button" onClick={() => setShowAll((v) => !v)}
                className={cn("mt-2 text-[11px]", linkClass)}>
                {showAll ? "Show fewer" : `Show ${suggested.length - 1} more like this`}
              </button>
            )}
          </div>
        )}
      </div>

      {/* THE PRICE. Suggestions fill the box; Save is the only write. */}
      <div className="mt-4">
        <p className={kickerClass}>Price</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Select value={basis} aria-label="Which summary the quick fills use"
            onChange={(e) => setBasis(e.target.value as BasisKey)}>
            {BASIS.map((b) => <option key={b.key} value={b.key}>Use the {b.label.toLowerCase()}</option>)}
          </Select>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => fillFrom("fmv")}>
            Use FMV
          </Button>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => fillFrom("resale")}>
            Keep Resale
          </Button>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => fillFrom("markup")}>
            FMV + {agg.target_markup_pct}%
          </Button>
        </div>

        {/* What the buttons would read, before anybody presses one. The variant count is the honest
            answer to "why is there a picker here at all". */}
        <p className="mt-2 text-xs text-ink-500">
          FMV {agg.fmv.min === null ? "none" : aud(agg.fmv.min) + "–" + aud(agg.fmv.max)}
          {agg.fmv.variants > 1 ? ` (${agg.fmv.variants} different values in this group)` : ""}
          {" · "}
          Resale {agg.resale.min === null ? "none" : aud(agg.resale.min) + "–" + aud(agg.resale.max)}
          {agg.basis.max !== null ? ` · cost up to ${aud(agg.basis.max)}` : ""}
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="w-44">
            <Input value={price} inputMode="numeric" placeholder="price in cents"
              aria-label="Price in cents" onChange={(e) => { setPrice(e.target.value); setSource("custom"); }} />
          </div>
          <Select value={source} aria-label="Where this price came from"
            onChange={(e) => setSource(e.target.value)}>
            <option value="custom">Custom</option>
            <option value="fmv">FMV</option>
            <option value="resale">Resale</option>
          </Select>
          <Button size="sm" disabled={busy} onClick={() => void savePrice()}>Save price</Button>
        </div>

        {belowCost > 0 && (
          <p className="mt-2 text-xs text-accent-700">
            At this price {belowCost} unit{belowCost === 1 ? "" : "s"} sell below what they cost, and
            the shop hides those. It is saved either way - hiding is the shop's decision, not a refusal.
          </p>
        )}
        {d.below_cost_if_priced_here && belowCost === 0 && (
          <p className="mt-2 text-xs text-accent-700">
            The saved price is below the cost of the dearest unit in this group.
          </p>
        )}
      </div>

      <div className="mt-4">
        <Button className="w-full" disabled={busy || !canPublish} onClick={() => void publish()}>
          Publish {agg.units_publishable > 0 ? agg.units_publishable + " unit" + (agg.units_publishable === 1 ? "" : "s") : "to storefront"}
        </Button>
        <p className="mt-1 text-xs text-ink-500">
          {d.price_override === null
            ? "Save a price first - publishing refuses a group nobody has priced."
            : agg.units_publishable === 0
              ? "Nothing waiting: every unit of this group is already on the shop."
              : d.image_url
                ? "Sets this price on every lot, publishes the new units, and opens their lots."
                : "Sets this price on every lot and publishes the new units. This group has no image yet, so the card falls back to the model's own photo."}
        </p>
      </div>

      {msg && <p className="mt-3 text-sm text-brand-300">{msg}</p>}
      {err && <p className="mt-3 text-sm text-danger-600">{err}</p>}
    </Card>
  );
}
