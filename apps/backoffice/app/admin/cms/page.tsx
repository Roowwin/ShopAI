"use client";

/* THE WEBSITE CMS.

   Three surfaces, and one rule each - every rule is about the same thing, which is that an operator
   should be looking at the shop rather than at a form.

   1. MODELS, NOT UNITS. The list is one entry per model, folded from every product that shares a
      brand and a model (site.ts) - the seeded catalogue carries both `iphone-13` and
      `seed-demo-ip13` for one phone, and the CMS used to show both as separate rows with a separate
      switch each. Editing the entry writes to the group, so what the brief asks for ("editing this
      entry updates the storefront for all associated assets") is what the door actually does.

   2. A PICTURE, NOT AN ADDRESS. The "Image URL" text box is gone. A model's photo is chosen from the
      catalogue's own `product_media` gallery, with the thumbnail of what will go live.

   3. NO SAVE BUTTON ANYWHERE. A switch writes on the press, a name writes when the field is left,
      and the hero writes itself a beat after typing stops. Every one of those has a failure path
      that says so and puts the control back, because an auto-save that silently does nothing is
      worse than a Save button that fails loudly.

   THE HOMEPAGE CARD EDITS THE DEAL, and nothing else. It used to be a split view - the hero's
   headline, sub-heading and button label on the left, the shop's own hero and deal card on the
   right - but the storefront no longer renders a hero, so both halves described something that
   could not appear. The three copy fields still travel in the saved payload (see hero.ts); they
   are simply no longer offered for editing. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button, Card, Heading, Input, PageHeader, Select, Switch, cn } from "@/app/components/ui";
import { apiFetch } from "@/lib/api";
import { requireRole, useMe } from "@/lib/session";
import { kickerClass, pageClass } from "@/lib/ui";
import { HOME_DEFAULTS, heroAsPublished, type Hero } from "./hero";
import MediaTray, { type GalleryItem } from "./MediaTray";
import Photo from "./Photo";
import { SITE, storefrontPage, modelName, groupModels, type CProd, type Model } from "./site";

type Promo = { id: number; name: string; kind: string; value: number; active: boolean };
type Save = "idle" | "saving" | "saved" | "error";

/* How many model entries are drawn at once. The catalogue has thousands of products and hundreds of
   models; drawing all of them makes every keystroke in the search box re-render the lot, and a list
   nobody can see the end of is not more useful than one that grows on request. */
const PAGE = 40;

function unitCount(n: number): string {
  return n + (n === 1 ? " unit" : " units");
}

/* Two drafts of the hero are the same draft when they would publish the same bytes. Compared on the
   NORMALISED form, so the auto-save does not fire for a keystroke that cannot change the shop, and
   does not miss one that can (a badge, a deal, a trailing character). */
function sameHero(a: Hero, b: Hero): boolean {
  const x = heroAsPublished(a);
  const y = heroAsPublished(b);
  return JSON.stringify(x) === JSON.stringify(y);
}

export default function CmsPage() {
  const { me, checked } = useMe();
  const allowed = requireRole(me, ["admin", "manager"]);

  const [hero, setHero] = useState<Hero>({ ...HOME_DEFAULTS });
  const [heroSave, setHeroSave] = useState<Save>("idle");
  const [promos, setPromos] = useState<Promo[]>([]);
  const [prods, setProds] = useState<CProd[]>([]);
  const [np, setNp] = useState({ name: "", kind: "percent", value: 10 });
  const [msg, setMsg] = useState("");
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(PAGE);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /* The hero draft last seen by the server. A ref, not state: it must not itself trigger a render
     or an effect, it only answers "is this draft already published?". */
  const published = useRef<Hero>({ ...HOME_DEFAULTS });

  const load = useCallback(async () => {
    try {
      const r = await apiFetch("/staff/cms/home");
      if (r.ok) { const j: Hero = await r.json(); setHero(j); published.current = j; }
    } catch { void 0; }
    try { const r = await apiFetch("/staff/cms/promotions"); if (r.ok) { setPromos(await r.json()); } } catch { void 0; }
    try { const r = await apiFetch("/staff/cms/products"); if (r.ok) { setProds(await r.json()); } } catch { void 0; }
  }, []);
  useEffect(() => {
    if (!checked) { return; }
    if (!allowed) { setMsg("admin or manager role required"); return; }
    void load();
  }, [checked, allowed, load]);

  const models = useMemo(() => groupModels(prods), [prods]);
  const bySlug = useMemo(() => new Map(prods.map((p) => [p.slug, p])), [prods]);
  const readyDeals = useMemo(
    () => prods.filter((p) => p.live_units > 0).sort((a, b) => a.title.localeCompare(b.title)),
    [prods]);
  const restDeals = useMemo(
    () => prods.filter((p) => p.live_units === 0).sort((a, b) => a.title.localeCompare(b.title)),
    [prods]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) { return models; }
    return models.filter((m) => (m.brand + " " + m.model).toLowerCase().includes(q)
      || m.products.some((p) => p.title.toLowerCase().includes(q) || p.slug.includes(q)));
  }, [models, query]);

  function flash(t: string) {
    setMsg(t);
    setTimeout(() => setMsg((cur) => (cur === t ? "" : cur)), 4000);
  }

  /* ---------------------------------------------------------------- hero */

  async function saveHero(draft: Hero): Promise<boolean> {
    setHeroSave("saving");
    try {
      const r = await apiFetch("/staff/cms/home", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft),
      });
      if (!r.ok) { setHeroSave("error"); flash("The homepage was not saved (" + r.status + ")"); return false; }
      const j: Hero = await r.json();
      published.current = j;
      setHeroSave("saved");
      return true;
    } catch (e: any) {
      setHeroSave("error");
      flash(String(e?.message ?? e));
      return false;
    }
  }

  /* Auto-save the hero a beat after typing stops. The effect is the whole mechanism: there is no
     Save button to forget, and no debounce timer to leak - React clears the previous one on every
     keystroke, and the last one is cleared on unmount. A draft the server already holds is not
     sent again, which is what stops this from looping on the value the PUT hands back. */
  useEffect(() => {
    if (!checked || !allowed) { return; }
    if (sameHero(hero, published.current)) { return; }
    const t = setTimeout(() => { void saveHero(hero); }, 650);
    return () => clearTimeout(t);
  }, [hero, checked, allowed]);

  function patchHero(patch: Partial<Hero>) { setHero((h) => ({ ...h, ...patch })); }

  function setDeal(slug: string) {
    const s = slug.trim();
    if (!s) { patchHero({ deal_of_month: null }); return; }
    const match = bySlug.get(s);
    patchHero({ deal_of_month: {
      title: match?.title ?? hero.deal_of_month?.title ?? "",
      product_slug: s,
      badge: hero.deal_of_month?.badge || "Deal of the Month",
    } });
  }

  /* ------------------------------------------------------------- models */

  /* Optimistic, with a rollback: the switch and the tile move under the press, and go back if the
     write is refused. Waiting for the round trip would make an auto-save feel like a form. */
  async function writeGroup(ids: number[], body: Record<string, unknown>, undo: () => void) {
    setBusy(true);
    try {
      const r = await apiFetch("/staff/cms/products", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, ...body }),
      });
      if (!r.ok) {
        undo();
        const j: any = await r.json().catch(() => ({}));
        flash(typeof j.detail === "string" ? j.detail : "That change was refused (" + r.status + ")");
        return false;
      }
      return true;
    } catch (e: any) {
      undo();
      flash(String(e?.message ?? e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function toggleFeatured(m: Model, next: boolean) {
    const ids = m.products.map((p) => p.id);
    setProds((arr) => arr.map((p) => (ids.includes(p.id) ? { ...p, featured: next } : p)));
    await writeGroup(ids, { featured: next },
      () => setProds((arr) => arr.map((p) => (ids.includes(p.id) ? { ...p, featured: !next } : p))));
  }

  async function pickPhoto(m: Model, item: GalleryItem) {
    const address = item.storage_key as string;
    const ids = m.products.map((p) => p.id);
    const before = new Map(m.products.map((p) => [p.id, p.image_url]));
    setProds((arr) => arr.map((p) => (ids.includes(p.id) ? { ...p, image_url: address } : p)));
    setOpenKey(null);
    await writeGroup(ids, { media_row_id: item.media_row_id },
      () => setProds((arr) => arr.map((p) => (ids.includes(p.id) ? { ...p, image_url: before.get(p.id) ?? null } : p))));
  }

  async function clearPhoto(m: Model) {
    const ids = m.products.map((p) => p.id);
    const before = new Map(m.products.map((p) => [p.id, p.image_url]));
    setProds((arr) => arr.map((p) => (ids.includes(p.id) ? { ...p, image_url: null } : p)));
    await writeGroup(ids, { image_url: "" },
      () => setProds((arr) => arr.map((p) => (ids.includes(p.id) ? { ...p, image_url: before.get(p.id) ?? null } : p))));
  }

  /* ------------------------------------------------------------- offers */

  async function togglePromo(p: Promo, next: boolean) {
    setPromos((arr) => arr.map((x) => (x.id === p.id ? { ...x, active: next } : x)));
    setBusy(true);
    try {
      const r = await apiFetch("/staff/cms/promotions/" + p.id, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: next }),
      });
      if (!r.ok) {
        setPromos((arr) => arr.map((x) => (x.id === p.id ? { ...x, active: !next } : x)));
        flash("That offer was not changed (" + r.status + ")");
      }
    } catch (e: any) {
      setPromos((arr) => arr.map((x) => (x.id === p.id ? { ...x, active: !next } : x)));
      flash(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  /* A name writes when the field is left, or on Enter - both of which are "done typing", and neither
     of which is a Save button. The value is only sent when it actually changed, so tabbing through
     the table is not a write per cell. */
  async function renamePromo(p: Promo, name: string) {
    const clean = name.trim().slice(0, 80);
    if (!clean || clean === p.name) { return; }
    const was = p.name;
    setPromos((arr) => arr.map((x) => (x.id === p.id ? { ...x, name: clean } : x)));
    setBusy(true);
    try {
      const r = await apiFetch("/staff/cms/promotions/" + p.id, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: clean }),
      });
      if (!r.ok) {
        setPromos((arr) => arr.map((x) => (x.id === p.id ? { ...x, name: was } : x)));
        flash("That name was not saved (" + r.status + ")");
      }
    } catch (e: any) {
      setPromos((arr) => arr.map((x) => (x.id === p.id ? { ...x, name: was } : x)));
      flash(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  async function addPromo() {
    setBusy(true);
    try {
      const r = await apiFetch("/staff/cms/promotions", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(np),
      });
      if (!r.ok) { flash("That offer was not added - check the value"); return; }
      setNp({ ...np, name: "" });
      const list = await apiFetch("/staff/cms/promotions");
      if (list.ok) { setPromos(await list.json()); }
    } catch (e: any) {
      flash(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  /* --------------------------------------------------------------- draw */

  /* `dealProduct` and `previewDeal` were built for the hero preview: it drew the deal card with
     the model's photo and said so when the product had no listed unit. Both are gone with it - and
     nothing is lost, because the select's own option groups already say which products are ready
     to sell and which the shop would hold back. */
  const knownSlug = !hero.deal_of_month || prods.length === 0 || bySlug.has(hero.deal_of_month.product_slug);

  /* The gates above stop the data loads, but this page still RENDERS the whole form - so without
     this, a warehouse user would be shown an editable CMS whose every write collects a 403. The
     server is the real wall (these doors are require_roles("admin","manager")); this just stops us
     presenting controls that cannot work. */
  if (checked && !allowed) {
    return (
      <main className={pageClass.wide}>
        <PageHeader title="Website CMS" />
        <div className="rounded-control bg-accent-100 text-accent-700 px-3 py-2 text-sm">admin or manager role required</div>
      </main>
    );
  }

  return (
    <main className={pageClass.wide}>
      <PageHeader title="Website CMS"
        description="Homepage, offers and models - changes go live immediately."
        actions={<a className="text-xs text-brand-300 hover:underline" href={SITE}>Open the storefront</a>} />

      {msg && (<div className="rounded-control bg-accent-100 text-accent-700 px-3 py-2 mb-3 text-sm">{msg}</div>)}

      {/* -------------------------------------------------------- homepage */}
      <Card className="p-4 mb-4">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <Heading level="h3" as="h2">Homepage</Heading>
          <span className={cn(kickerClass, "text-ink-500")}>
            {heroSave === "saving" ? "saving..." : heroSave === "saved" ? "saved" :
             heroSave === "error" ? "not saved" : "saves as you type"}
          </span>
        </div>

        {/* THE HERO EDITOR AND ITS PREVIEW ARE GONE. This card used to be a split view: the
            headline, sub-heading and button label on the left, the shop's own hero and deal card
            redrawn on the right. The storefront no longer renders a hero, so those three fields
            edited copy that could not appear anywhere and the picture showed something that could
            not exist.

            The fields themselves are NOT removed from the payload - they share an object with
            `deal_of_month`, which is what this card now exists to edit, and the whole object is
            what PUT /staff/cms/home receives. They are loaded and written back untouched, so a save
            here cannot blank what a hero would need if one came back. See hero.ts. */}
        <div className="max-w-xl">
          <label htmlFor="cms-hero-deal" className={cn(kickerClass, "block pb-1")}>Deal of the month</label>
          <Select id="cms-hero-deal" className="w-full"
                  value={hero.deal_of_month?.product_slug ?? ""}
                  onChange={(e) => setDeal(e.target.value)}>
            <option value="">No deal - the section is off</option>
            {hero.deal_of_month && !knownSlug && (
              <option value={hero.deal_of_month.product_slug}>
                {hero.deal_of_month.product_slug} (not in the catalogue)
              </option>
            )}
            {readyDeals.length > 0 && (
              <optgroup label="Ready to sell">
                {readyDeals.map((p) => (
                  <option key={p.id} value={p.slug}>{p.title}</option>
                ))}
              </optgroup>
            )}
            {restDeals.length > 0 && (
              <optgroup label="No unit listed yet - the shop would hold this back">
                {restDeals.map((p) => (
                  <option key={p.id} value={p.slug}>{p.title}</option>
                ))}
              </optgroup>
            )}
          </Select>

          {hero.deal_of_month && (
            <>
              <label htmlFor="cms-hero-badge" className={cn(kickerClass, "mt-3 block pb-1")}>Deal badge</label>
              <Input id="cms-hero-badge" placeholder="Deal of the Month"
                     value={hero.deal_of_month.badge}
                     onChange={(e) => {
                       const d = hero.deal_of_month;
                       if (d) { patchHero({ deal_of_month: { ...d, badge: e.target.value } }); }
                     }} />
            </>
          )}
        </div>
      </Card>

      {/* ------------------------------------------------------- offers */}
      <Card className="p-4 mb-4">
        <Heading level="h3" as="h2" className="mb-2">Offers</Heading>
        <ul className="divide-y divide-line">
          {promos.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-3 py-2">
              <div className="min-w-[12rem] flex-1">
                {/* Keyed by the name the row now holds: an uncontrolled field keeps whatever was
                    typed into it, so a refused rename would leave the wrong word on screen. A new
                    key remounts the field from the state the server agrees with. */}
                <Input key={p.id + ":" + p.name} defaultValue={p.name}
                       aria-label={"Offer name for offer " + p.id} disabled={busy}
                       onBlur={(e) => void renamePromo(p, e.target.value)}
                       onKeyDown={(e) => { if (e.key === "Enter") { e.currentTarget.blur(); } }} />
              </div>
              <span className="text-xs text-ink-500">
                {p.kind === "percent" ? p.value + "% off" : p.value + " cents off"}
              </span>
              <span className="text-xs text-ink-500">{p.active ? "live on the shop" : "off"}</span>
              <Switch checked={p.active} disabled={busy} label={"Show the offer " + p.name + " on the storefront"}
                      onChange={(next) => void togglePromo(p, next)} />
            </li>
          ))}
          {promos.length === 0 && (
            <li className="py-2 text-sm text-ink-500">No offers yet - add one below.</li>
          )}
        </ul>

        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="min-w-[12rem] flex-1">
            <label htmlFor="cms-offer-name" className={cn(kickerClass, "block pb-1")}>New offer</label>
            <Input id="cms-offer-name" placeholder="offer name" value={np.name}
                   onChange={(e) => setNp({ ...np, name: e.target.value })} />
          </div>
          <Select aria-label="Offer kind" value={np.kind} onChange={(e) => setNp({ ...np, kind: e.target.value })}>
            <option value="percent">percent</option>
            <option value="fixed">fixed</option>
          </Select>
          <div className="w-28">
            <Input type="number" aria-label="Offer value" value={np.value}
                   onChange={(e) => setNp({ ...np, value: Number(e.target.value) })} />
          </div>
          <Button onClick={() => void addPromo()} disabled={busy}>Add offer</Button>
        </div>
      </Card>

      {/* ------------------------------------------------------- models */}
      <Card className="p-4">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <Heading level="h3" as="h2">Models</Heading>
            <p className="pt-1 text-xs text-ink-500">
              One entry per model. Every unit of a model is the same page and the same photo, so a
              change here reaches all of them.
            </p>
          </div>
          <div className="w-full sm:w-64">
            <label htmlFor="cms-model-q" className={cn(kickerClass, "block pb-1")}>Find a model</label>
            <Input id="cms-model-q" placeholder="brand, model, title or slug" value={query}
                   onChange={(e) => { setQuery(e.target.value); setShown(PAGE); setOpenKey(null); }} />
          </div>
        </div>

        <p className="pb-2 text-xs text-ink-500">
          {filtered.length} model{filtered.length === 1 ? "" : "s"}
          {query.trim() ? " matching" : ""} &middot; {filtered.reduce((n, m) => n + m.products.length, 0)} products
        </p>

        <ul className="divide-y divide-line">
          {filtered.slice(0, shown).map((m) => {
            const open = openKey === m.key;
            return (
              <li key={m.key} className="py-3">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="h-14 w-14 shrink-0 overflow-hidden rounded-control bg-surface-sunken ring-1 ring-line">
                    <Photo address={m.address} alt={modelName(m)} className="h-14 w-14 object-cover"
                           fallback={
                             <span className="flex h-14 w-14 items-center justify-center px-1 text-center text-xs leading-tight text-ink-500">
                               no photo
                             </span>
                           } />
                  </span>

                  <span className="min-w-[12rem] flex-1">
                    <span className="block text-sm font-semibold text-ink-900">{modelName(m)}</span>
                    <span className="block text-xs text-ink-500">
                      {m.brand} &middot; {m.categories.join(", ")} &middot; {unitCount(m.units)}
                      {m.live !== m.units ? " (" + m.live + " ready to sell)" : ""}
                      {" · "}
                      {m.products.length} product page{m.products.length === 1 ? "" : "s"}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-2">
                      {m.products.slice(0, 3).map((p) => (
                        <a key={p.id} className="text-xs text-brand-300 hover:underline"
                           href={storefrontPage(p.slug)}>{p.title}</a>
                      ))}
                      {m.products.length > 3 && (
                        <span className="text-xs text-ink-500">+{m.products.length - 3} more</span>
                      )}
                    </span>
                  </span>

                  <span className="flex items-center gap-2">
                    {/* The switch reads ON only when the whole group is featured. A group whose
                        members disagree says so rather than picking a side silently. */}
                    <Switch checked={m.featured} disabled={busy}
                            label={"Feature " + modelName(m) + " on the storefront"}
                            onChange={(next) => void toggleFeatured(m, next)} />
                    <span className="text-xs text-ink-500">
                      Featured{m.mixedFeatured ? " (mixed)" : ""}
                    </span>
                  </span>

                  <Button variant="secondary" size="sm" disabled={busy}
                          onClick={() => setOpenKey(open ? null : m.key)}>
                    {open ? "Cancel" : "Choose photo"}
                  </Button>
                </div>

                {open && (
                  <MediaTray current={m.address} busy={busy}
                             onPick={(it) => void pickPhoto(m, it)}
                             onClear={() => void clearPhoto(m)}
                             onClose={() => setOpenKey(null)} />
                )}
              </li>
            );
          })}
          {filtered.length === 0 && (
            <li className="py-2 text-sm text-ink-500">
              {query.trim() ? "No model matches that." : "No products in the catalogue."}
            </li>
          )}
        </ul>

        {filtered.length > shown && (
          <div className="pt-3">
            <Button variant="secondary" onClick={() => setShown(shown + PAGE)}>
              Show {Math.min(PAGE, filtered.length - shown)} more models
            </Button>
          </div>
        )}
      </Card>
    </main>
  );
}
