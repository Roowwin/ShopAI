"use client";

import { useState } from "react";
import { API } from "@/lib/api";
import { Button, EmptyState, ProductCard } from "./ui";

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
        <div className="flex flex-wrap gap-2 mt-6">
          <Button variant={cat === null ? "primary" : "secondary"} size="sm" onClick={() => pick(null)}>All</Button>
          {categories.map((c) => (
            <Button key={c.name} variant={cat === c.name ? "primary" : "secondary"} size="sm" onClick={() => pick(c.name)}>{c.name} ({c.n})</Button>
          ))}
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-6 mt-8">
        {items.map((i) => (
          <ProductCard key={i.slug} variant="full" href={"/products/" + i.slug} title={i.title}
            brand={i.brand} category={i.category} slug={i.slug} imageUrl={i.image_url}
            priceCents={i.price_from_cents} stock={{ n: i.units_available }} />
        ))}
        {items.length === 0 && <EmptyState className="col-span-full">Nothing listed in this category yet.</EmptyState>}
      </div>
      {more && (
        <div className="text-center mt-10">
          <Button variant="secondary" onClick={() => void fetchPage(false, cat)} disabled={busy}>{busy ? "Loading..." : "Load more"}</Button>
        </div>
      )}
    </div>
  );
}
