"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { Button, Card, Heading, Input, Select, Table, TBody, TD, TH, THead, TR } from "@/app/components/ui";
import { requireRole, useMe } from "@/lib/session";

type Deal = { title: string; product_slug: string; badge: string };
type Hero = { hero_title: string; hero_sub: string; cta_label: string; deal_of_month?: Deal | null };
type Promo = { id: number; name: string; kind: string; value: number; active: boolean };
type CProd = { id: number; title: string; slug: string; category: string; image_url: string | null; featured: boolean; listed_units: number };

export default function CmsPage() {
  const { me, checked } = useMe();
  const allowed = requireRole(me, ["admin", "manager"]);
  const [hero, setHero] = useState<Hero>({ hero_title: "", hero_sub: "", cta_label: "" });
  const [promos, setPromos] = useState<Promo[]>([]);
  const [prods, setProds] = useState<CProd[]>([]);
  const [np, setNp] = useState({ name: "", kind: "percent", value: 10 });
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    try { const r = await apiFetch("/staff/cms/home"); if (r.ok) { setHero(await r.json()); } } catch { void 0; }
    try { const r = await apiFetch("/staff/cms/promotions"); if (r.ok) { setPromos(await r.json()); } } catch { void 0; }
    try { const r = await apiFetch("/staff/cms/products"); if (r.ok) { setProds(await r.json()); } } catch { void 0; }
  }, []);
  useEffect(() => {
    if (!checked) { return; }
    if (!allowed) { setMsg("admin or manager role required"); return; }
    void load();
  }, [checked, allowed, load]);

  function flash(t: string) { setMsg(t); setTimeout(() => setMsg(""), 2500); }

  async function saveHero() {
    const r = await apiFetch("/staff/cms/home", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(hero) });
    flash(r.ok ? "Homepage saved - live on the storefront" : "Save failed");
    if (r.ok) { const j: any = await r.json().catch(() => ({})); setHero(j); }
  }

  function setDealSlug(slug: string) {
    const s = slug.trim();
    if (!s) { setHero({ ...hero, deal_of_month: null }); return; }
    const match = prods.find((p) => p.slug === s);
    setHero({ ...hero, deal_of_month: {
      title: match?.title ?? hero.deal_of_month?.title ?? "",
      product_slug: s,
      badge: hero.deal_of_month?.badge || "Deal of the Month",
    } });
  }

  async function addPromo() {
    const r = await apiFetch("/staff/cms/promotions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(np) });
    if (r.ok) { flash("Offer added"); await load(); } else { flash("Add failed - check value"); }
  }

  async function togglePromo(p: Promo) {
    const r = await apiFetch("/staff/cms/promotions/" + p.id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: !p.active }) });
    if (r.ok) { await load(); }
  }

  async function saveProduct(p: CProd) {
    const r = await apiFetch("/staff/cms/products/" + p.id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image_url: p.image_url ?? "", featured: p.featured }) });
    flash(r.ok ? "Product updated" : "Update failed");
  }

  /* The gates above stop the data loads, but this page still RENDERS the whole form - so without
     this, a warehouse user would be shown an editable CMS whose every Save collects a 403. The
     server is the real wall (these doors are require_roles("admin","manager")); this just stops us
     presenting controls that cannot work. */
  if (checked && !allowed) {
    return (
      <main className="max-w-6xl mx-auto p-4 min-h-screen">
        <div className="bg-ink-900 text-white rounded-card px-5 py-3 mb-4 flex items-center gap-3">
          <Heading level="h1">Website CMS</Heading>
        </div>
        <div className="rounded-control bg-accent-100 text-accent-700 px-3 py-2 text-sm">admin or manager role required</div>
      </main>
    );
  }

  return (
    <main className="max-w-6xl mx-auto p-4 min-h-screen">
      <div className="bg-ink-900 text-white rounded-card px-5 py-3 mb-4 flex items-center gap-3">
        <Heading level="h1">Website CMS</Heading>
        <span className="text-xs text-ink-400">hero content - offers - featured products (live on the storefront)</span>
      </div>
      {msg && (<div className="rounded-control bg-brand-100 text-brand-300 px-3 py-2 mb-3 text-sm">{msg}</div>)}

      <Card className="p-4 mb-4">
        <Heading level="h3" as="h2" className="mb-2">Homepage hero</Heading>
        <Input className="mb-2" placeholder="hero title" value={hero.hero_title}
          onChange={(e) => setHero({ ...hero, hero_title: e.target.value })} />
        <Input className="mb-2" placeholder="hero subtitle" value={hero.hero_sub}
          onChange={(e) => setHero({ ...hero, hero_sub: e.target.value })} />
        <Input className="mb-2" placeholder="deal of the month product slug (blank = off)"
          value={hero.deal_of_month?.product_slug ?? ""}
          onChange={(e) => setDealSlug(e.target.value)} />
        <div className="flex gap-2">
          <Input className="flex-1" placeholder="button label (e.g. Shop devices)" value={hero.cta_label}
            onChange={(e) => setHero({ ...hero, cta_label: e.target.value })} />
          <Button onClick={() => void saveHero()}>Save</Button>
        </div>
      </Card>

      <Card className="p-4 mb-4">
        <Heading level="h3" as="h2" className="mb-2">Offers</Heading>
        <Table label="Offers">
          <THead>
            <TH>Name</TH><TH>Tier</TH><TH>Value</TH><TH>Status</TH><TH></TH>
          </THead>
          <TBody>
            {promos.map((p) => (
              <TR key={p.id}>
                <TD>{p.name}</TD>
                <TD>{p.kind}</TD>
                <TD>{p.value}{p.kind === "percent" ? "%" : ""}</TD>
                <TD>
                  {/* size="inline" keeps the toggle's text on the cell's own text grid; ghost =
                      the active (brand) state, muted = the quiet off state. */}
                  <Button size="inline" variant={p.active ? "ghost" : "muted"} onClick={() => void togglePromo(p)}>
                    {p.active ? "Active" : "Off"}
                  </Button>
                </TD>
                <TD className="text-xs text-ink-500">id {p.id}</TD>
              </TR>
            ))}
            {promos.length === 0 && (<TR><TD colSpan={5} className="text-ink-500">No offers yet - add one below.</TD></TR>)}
          </TBody>
        </Table>
        <div className="flex flex-wrap gap-2 mt-3 items-center">
          <div className="w-48">
            <Input placeholder="offer name" value={np.name} onChange={(e) => setNp({ ...np, name: e.target.value })} />
          </div>
          <Select value={np.kind} onChange={(e) => setNp({ ...np, kind: e.target.value })}>
            <option value="percent">percent</option>
            <option value="fixed">fixed</option>
          </Select>
          <div className="w-24">
            <Input type="number" value={np.value} onChange={(e) => setNp({ ...np, value: Number(e.target.value) })} />
          </div>
          <Button onClick={() => void addPromo()}>Add offer</Button>
        </div>
      </Card>

      <Card className="p-4">
        <Heading level="h3" as="h2" className="mb-2">Products - image URL and featured</Heading>
        <Table label="Products">
          <THead>
            <TH>Product</TH><TH>Units</TH><TH>Image URL</TH><TH>Featured</TH><TH></TH>
          </THead>
          <TBody>
            {prods.map((p, i) => (
              <TR key={p.id}>
                <TD>
                  <a className="text-brand-300" href={"/products/" + p.slug}>{p.title}</a>
                  <p className="text-xs text-ink-500">{p.category}</p>
                </TD>
                <TD>{p.listed_units}</TD>
                <TD><div className="w-64">
                  <Input placeholder="https://... image URL"
                    value={p.image_url ?? ""}
                    onChange={(e) => setProds((arr) => arr.map((x, k) => (k === i ? { ...x, image_url: e.target.value } : x)))} />
                </div></TD>
                <TD><input type="checkbox" checked={p.featured}
                  onChange={(e) => setProds((arr) => arr.map((x, k) => (k === i ? { ...x, featured: e.target.checked } : x)))} /></TD>
                <TD><Button variant="secondary" size="sm" onClick={() => void saveProduct(prods[i])}>Save</Button></TD>
              </TR>
            ))}
            {prods.length === 0 && (<TR><TD colSpan={5} className="text-ink-500">No products.</TD></TR>)}
          </TBody>
        </Table>
      </Card>
    </main>
  );
}
