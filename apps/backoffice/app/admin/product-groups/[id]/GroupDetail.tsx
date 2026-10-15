"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { aud } from "@/lib/format";
import { Badge, Button, Card, Input, Select, Stat, Table, TBody, TD, TH, THead, TR, cn } from "@/app/components/ui";
import { kickerClass, linkClass, statusTone } from "@/lib/ui";
import { BASIS, Detail, stateBadge, type BasisKey } from "../shared";

/* ONE MODEL + GRADE, on its own page: its photograph, the units it holds, its price, and the publish
   button.

   WHY IT MOVED OFF THE LIST. It was the right-hand pane of the Product groups table, which meant
   nine columns of stock were squeezed into whatever a 360px drawer left over, and the pane had to
   carry a whole editing surface inside a column. The list is a table now and this is a page: the
   photograph gets the room it needs to be judged, and the price gets a row of suggestions with the
   working printed beside them rather than folded into a sidebar.

   THE UNITS ARE LISTED BETWEEN THE TWO, because a group is a decision about stock and the page used
   to state how much stock there was without ever showing a row of it. Five first, a page at a time
   after that, and a row opens the unit's own record.

   NOTHING HERE WRITES WITHOUT A PRESS. FMV, Resale and "FMV + 60%" fill the box and stop; Save is a
   separate act and the only thing that sets `price_override`; publishing refuses a group with no
   price at all. That has not changed and is the point of the screen - see staff_groups.py. The unit
   table is a READ, and the only thing on this page it can be read as writing is the publish. */

/* One pooled photograph as a thumbnail. The public `/media/...` address does not exist on the ADMIN
   host, so the bytes come through the authenticated raw door into an object URL - revoked when the
   tile goes, or a scroll through a folder's worth of suggestions leaks one blob each. */
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

/* WHAT THE GROUP'S STOCK IS SHOWN FROM. The Inventory door's own row, cut to the columns that are
   not already fixed by being on this page: brand, model and grade are the group itself, so printing
   them in every row would be four copies of the heading. */
type Unit = {
  id: number; serial_number: string | null; status: string; grade: string | null;
  sale_price_cents: number | null; location: string | null; lot_number: string;
};

/* FIVE FIRST, then a page at a time. The card's first job is to answer "have I actually got any of
   this, and where is it" - five rows and a count do that, and a group holding three hundred units
   should not push the price editor a screen and a half down the page to say so. */
const UNITS_FIRST = 5;
/* The Inventory door's OWN ceiling on `limit`. Asking for more would be asking for less. */
const UNITS_PAGE = 100;

export default function GroupDetail({ groupId }: { groupId: number }) {
  const router = useRouter();
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
    if (!r.ok) {
      // A group that does not exist is a different fact from a read that failed, and the page is
      // reachable by typing a URL now that it has one - so it says which.
      setErr(r.status === 404 ? "That product group does not exist." : "could not load that group");
      return;
    }
    const j: Detail = await r.json();
    setD(j);
    setPrice(j.price_override === null ? "" : String(j.price_override));
    setSource(j.price_source ?? "custom");
    setBelowCost(0);
  }, [groupId]);

  useEffect(() => { void load(); }, [load]);

  /* THE UNITS THEMSELVES, which is the half of this page that is not configuration. The screen knew
     how many units a group had - its three Stat tiles are counts - and never showed one, so "what
     have I got, and where is it" was answerable only by leaving the group and filtering the
     Inventory by brand and grade by hand.

     THE SET IS THE SAME ONE THE TILES COUNT. `group_id` on the Inventory door spells out the join
     `staff_groups.UNITS_OF_GROUP` counts (brand + model + grade, under every category re-spelling),
     so the footer's "5 of 12" and the "12 waiting" tile above it cannot disagree - and
     test_product_groups pins the two to each other rather than trusting that they do.

     A read, and only ever a read: nothing on this page writes to a unit. A row opens the unit's own
     record, which is where its price and its photographs live. */
  const [units, setUnits] = useState<Unit[]>([]);
  const [unitsErr, setUnitsErr] = useState("");
  const [unitsBusy, setUnitsBusy] = useState(false);
  const [unitsRead, setUnitsRead] = useState(false);

  const loadUnits = useCallback(async (limit: number, offset: number) => {
    setUnitsErr("");
    const r = await apiFetch(`/staff/assets?group_id=${groupId}&limit=${limit}&offset=${offset}`);
    if (!r.ok) {
      // 403 is its own fact here: the group doors and the Inventory door take the SAME role tuple,
      // so a session that can read the group but not its units is a wiring bug, not a permission.
      setUnitsErr(r.status === 403 ? "admin or manager role required"
        : "the stock of this group could not be read (" + r.status + ")");
      setUnitsRead(true);
      return;
    }
    const j: Unit[] = await r.json();
    // Offset 0 REPLACES, anything else APPENDS - which is what makes the first five and every later
    // page the same request shape rather than two code paths that can drift apart.
    setUnits((prev) => (offset === 0 ? j : [...prev, ...j]));
    setUnitsRead(true);
  }, [groupId]);

  useEffect(() => { void loadUnits(UNITS_FIRST, 0); }, [loadUnits]);

  async function moreUnits() {
    setUnitsBusy(true);
    try { await loadUnits(UNITS_PAGE, units.length); } finally { setUnitsBusy(false); }
  }

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

  /* WHAT THE APP THINKS THIS GROUP'S PHOTOGRAPH IS. A read, and only ever a read: the ranked list
     arrives, a person looks at the pictures and presses once for the one they want. Re-read
     whenever the pool changes, because accepting one takes it out of the pool and the next-best
     suggestion becomes the first one. */
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
    setSource(which === "resale" ? "resale" : "fmv");
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
      setMsg(`${j.listed} unit${j.listed === 1 ? "" : "s"} published for ${j.model} / Grade ${j.grade}.`
        + (missing.length ? ` Not showing: ${missing.join(", ")}.` : ""));
      await load();
      // Publishing is the one press here that changes the UNITS as well as the group - it opens
      // their lots, writes the price onto every one of them and takes them to `listed` - so the
      // table below is re-read at the size it is already showing, rather than left saying "received".
      await loadUnits(Math.max(UNITS_FIRST, units.length), 0);
    } catch {
      setErr("that publish could not be sent");
    } finally {
      setBusy(false);
    }
  }

  if (!d) return <Card className="p-4 text-sm text-ink-500">{err || "Loading…"}</Card>;

  const agg = d.aggregates;
  const badge = stateBadge(d.state);
  const canPublish = d.price_override !== null && agg.units_publishable > 0;
  /* The group's own count, not a second one from the Inventory door: this is the number the tiles
     above are already showing, so the footer cannot contradict them. */
  const total = agg.units_total;

  return (
    <div className="space-y-4">
      <Card className="p-6">
        <p className={kickerClass}>
          {d.brand}
          {d.categories.length > 0 && <span className="text-ink-400">{" · "}{d.categories.join(", ")}</span>}
        </p>
        <h1 className="mt-1 text-h2 font-semibold text-ink-900">{d.model}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <span className="text-sm font-semibold text-ink-700">Grade {d.grade}</span>
          <span className={cn("inline-flex items-center text-xs font-semibold rounded-full px-2 py-0.5", badge.cls)}>
            {badge.text}
          </span>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Stat label="Units" value={agg.units_total} sub={agg.units_listed + " on the shop"} />
          <Stat label="Waiting to publish" value={agg.units_publishable} sub="not on the shop yet" />
          <Stat label="Price" value={d.price_override === null ? "not set" : aud(d.price_override)}
            sub={d.price_source ? "from " + d.price_source : "nobody has priced it"} />
        </div>
      </Card>

      {/* THE PHOTOGRAPH. One per model and grade: attaching it here is what every lot of that
          model+grade reads, so there is no second "apply" step. */}
      <Card className="p-6">
        <p className={kickerClass}>Image</p>
        <div className="mt-3 flex flex-wrap items-start gap-5">
          <div className="h-48 w-64 shrink-0 overflow-hidden rounded-card bg-surface-sunken ring-1 ring-line flex items-center justify-center">
            {thumb
              ? <img src={thumb} alt="" className="h-full w-full object-cover" />
              : <span className="text-xs text-ink-400">{d.image_url ? "…" : "No photograph yet"}</span>}
          </div>
          <div className="min-w-[16rem] flex-1">
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />
            <Button size="sm" variant="secondary" disabled={busy}
              onClick={() => fileRef.current?.click()}>
              {d.image_url ? "Replace image" : "Upload image"}
            </Button>
            <p className="mt-2 text-xs text-ink-500">
              JPEG, PNG, WebP or GIF, up to 5 MB. One photograph covers this model and grade in every
              lot it appears in.
            </p>
          </div>
        </div>

        {/* THE SUGGESTION, from the folder that was uploaded on the Photo folder page. It is OFFERED
            and never applied: the button beside it is the only thing that attaches anything, and it
            belongs to whoever is looking at the picture. The matched words are printed with it so
            the offer can be argued with rather than taken on faith.
            ABSENT WHEN THERE IS NOTHING TO OFFER - a strip showing a weak guess would teach the
            operator to ignore it, and then to ignore the good ones. */}
        {suggested.length > 0 && (
          <div className="mt-4 rounded-control bg-surface-muted p-3 ring-1 ring-line">
            <p className="text-xs font-semibold text-ink-900">In the folder you uploaded</p>
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
      </Card>

      {/* THE STOCK ITSELF, BETWEEN THE PHOTOGRAPH AND THE PRICE. Both of those are decisions about
          the whole group; this is what the decisions are being taken over, and it was the one thing
          the page did not show - the tiles said "12 units" and no unit was ever listed. */}
      <Card className="p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className={kickerClass}>Units in this group</p>
          <p className="text-xs text-ink-500">
            {total === 0 ? "none yet" : `${units.length} of ${total} shown`}
          </p>
        </div>

        <div className="mt-3">
          <Table label="Units in this group">
            <THead>
              <TH>Serial</TH>
              <TH>Status</TH>
              <TH className="text-right">Price</TH>
              <TH>Location</TH>
              <TH>Lot</TH>
            </THead>
            <TBody>
              {units.map((u) => (
                <TR key={u.id} tabIndex={0}
                  onClick={() => router.push("/admin/assets/" + u.id)}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget) { return; }
                    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); router.push("/admin/assets/" + u.id); }
                  }}
                  className={cn("cursor-pointer transition-colors duration-fast ease-out",
                    "hover:bg-surface-muted motion-reduce:transition-none",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-700")}>
                  <TD className="font-mono">
                    <span className="text-brand-300">{u.serial_number ?? "#" + u.id}</span>
                  </TD>
                  <TD><Badge colorClass={statusTone(u.status)}>{u.status}</Badge></TD>
                  <TD className="text-right">
                    {u.sale_price_cents === null ? <span className="text-ink-500">-</span> : aud(u.sale_price_cents)}
                  </TD>
                  <TD className="text-ink-600">{u.location ?? "-"}</TD>
                  <TD className="font-mono text-xs text-ink-600">{u.lot_number}</TD>
                </TR>
              ))}
              {units.length === 0 && (
                <TR>
                  <TD colSpan={5} className="py-6 text-center text-sm text-ink-500">
                    {/* Three different facts, and each sends the operator somewhere else. A group can
                        legitimately have no stock - it is declared by the import, before the units
                        land - so "none yet" is not a failure and must not read as one. */}
                    {unitsErr ? unitsErr
                      : total === 0 ? "No unit of this model and grade has been imported yet."
                        : unitsRead ? "This group counts units that could not be listed here."
                          : "Loading…"}
                  </TD>
                </TR>
              )}
            </TBody>
          </Table>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          {/* Labelled by what the press actually does: when the rest fits in one page it says so and
              fetches everything, and when it does not it names the page rather than promising "all"
              and delivering a hundred. */}
          {units.length < total && (
            <Button variant="secondary" size="sm" disabled={unitsBusy} onClick={() => void moreUnits()}>
              {total - units.length <= UNITS_PAGE ? `Show all ${total} units` : `Show ${UNITS_PAGE} more`}
            </Button>
          )}
          {units.length > UNITS_FIRST && (
            <button type="button" className={cn("text-[11px]", linkClass)}
              onClick={() => setUnits(units.slice(0, UNITS_FIRST))}>
              Show fewer
            </button>
          )}
          {units.length > 0 && (
            <p className="text-xs text-ink-500">Press a row for that unit&apos;s full record.</p>
          )}
        </div>
        {unitsErr && units.length > 0 && (
          <p className="mt-2 text-sm text-danger-600">{unitsErr} - the rows above are the ones already read.</p>
        )}
      </Card>

      <Card className="p-6">
        <p className={kickerClass}>Price</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Select value={basis} aria-label="Which summary the quick fills use"
            onChange={(e) => setBasis(e.target.value as BasisKey)}>
            {BASIS.map((b) => <option key={b.key} value={b.key}>Use the {b.label.toLowerCase()}</option>)}
          </Select>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => fillFrom("fmv")}>Use FMV</Button>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => fillFrom("resale")}>Keep Resale</Button>
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

        <div className="mt-4 flex flex-wrap items-center gap-2">
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
      </Card>

      <Card className="p-6">
        <Button className="w-full" disabled={busy || !canPublish} onClick={() => void publish()}>
          Publish {agg.units_publishable > 0 ? agg.units_publishable + " unit" + (agg.units_publishable === 1 ? "" : "s") : "to storefront"}
        </Button>
        <p className="mt-2 text-xs text-ink-500">
          {d.price_override === null
            ? "Save a price first - publishing refuses a group nobody has priced."
            : agg.units_publishable === 0
              ? "Nothing waiting: every unit of this group is already on the shop."
              : d.image_url
                ? "Sets this price on every lot, publishes the new units, and opens their lots."
                : "Sets this price on every lot and publishes the new units. This group has no image yet, so the card falls back to the model's own photo."}
        </p>
      </Card>

      {msg && <p className="text-sm text-brand-300">{msg}</p>}
      {err && <p className="text-sm text-danger-600">{err}</p>}
    </div>
  );
}
