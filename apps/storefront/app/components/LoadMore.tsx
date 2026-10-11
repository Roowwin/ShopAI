"use client";

import { useState } from "react";
import { API, aud } from "@/lib/api";
import ProductArt from "./ProductArt";
import { Badge, Button, Card, EmptyState, Eyebrow } from "./ui";

type Cat = { name: string; n: number };

export default function LoadMore({ initial, categories }: { initial: any[]; categories?: Cat[] }) {
  const [items, setItems] = useState<any[]>(initial ?? []);
  const [off, setOff] = useState((initial ?? []).length);
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState((initial ?? []).length >= 8);
  const [cat, setCat] = useState<string | null>(null);

  async function fetchPage(reset: boolean, category: string | null) {
    setBusy(true);
    try {
      const url = API + "/store/catalog?limit=8&offset=" + (reset ? 0 : off) + (category ? "&category=" + encodeURIComponent(category) : "");
      const r = await fetch(url, { cache: "no-store" });
      if (r.ok) {
        const j: any[] = await r.json();
        if (reset) { setItems(j); setOff(j.length); } else { setItems((p) => [...p, ...j]); setOff(off + j.length); }
        setMore(j.length >= 8);
      }
    } catch { void 0; }
    setBusy(false);
  }

  function pick(name: string | null) {
    setCat(name);
    void fetchPage(true, name);
  }

  return (
    <div>
      {categories && categories.length > 1 && (
        <div className="flex flex-wrap gap-2 mt-4">
          <Button variant={cat === null ? "primary" : "secondary"} size="sm" onClick={() => pick(null)}>All</Button>
          {categories.map((c) => (
            <Button key={c.name} variant={cat === c.name ? "primary" : "secondary"} size="sm" onClick={() => pick(c.name)}>{c.name} ({c.n})</Button>
          ))}
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 mt-5">
        {items.map((i) => (
          <Card key={i.slug} radius="control" interactive href={"/products/" + i.slug} className="group overflow-hidden">
            <div className="relative">
              <ProductArt slug={i.slug} imageUrl={i.image_url} alt={i.title} className="w-full aspect-[4/3] object-cover"
                fallback={
                <div className="aspect-[4/3] bg-gradient-to-br from-surface-sunken to-line flex items-center justify-center">
                  <span className="text-xl font-bold text-ink-400">{(i.brand || "?").slice(0, 2).toUpperCase()}</span>
                </div>} />
              {!i.image_url && (
                <Badge colorClass="bg-brand-600 text-white" className="absolute top-2 right-2">Eco choice</Badge>
              )}
            </div>
            <div className="p-3">
              <Eyebrow>{i.brand} - {i.category}</Eyebrow>
              <p className="font-medium mt-1 truncate">{i.title}</p>
              <div className="mt-2 flex items-center justify-between">
                <span className="font-semibold text-sm">{i.price_from_cents !== null ? aud(i.price_from_cents) : "-"}</span>
                <Badge colorClass={i.units_available > 0 ? "bg-brand-50 text-brand-700" : "bg-surface-sunken text-ink-500"}>{i.units_available} in stock</Badge>
              </div>
              <p className="text-xs text-brand-700 mt-2.5 opacity-0 group-hover:opacity-100 transition">View product</p>
            </div>
          </Card>
        ))}
        {items.length === 0 && <EmptyState className="col-span-full">Nothing listed in this category yet.</EmptyState>}
      </div>
      {more && (
        <div className="text-center mt-6">
          <Button variant="secondary" onClick={() => void fetchPage(false, cat)} disabled={busy}>{busy ? "Loading..." : "Load more"}</Button>
        </div>
      )}
    </div>
  );
}
