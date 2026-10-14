"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { aud } from "@/lib/format";
import { Badge, Button, Card, Input, PageHeader, Select, Stat, Table, TBody, TD, TH, THead, TR, cn } from "@/app/components/ui";
import { gradeTone, pageClass, statusTone } from "@/lib/ui";

/* THE INVENTORY: every unit the shop holds, in any state, filtered and paged.

   WHAT THIS REPLACED, and why the shape changed rather than the styling. It was a queue of the
   fifty most recent units with three columns and a search that filtered the rows already fetched -
   a limitation the old header confessed to in prose and the operator met as "not in stock" for a
   serial that was sitting on page four. With 1,975 units across 25 brands and 15 categories, the
   question the owner actually asks - what do I have, what have I sold, where is it - could not be
   answered by three columns and no total.

   SO: NINE COLUMNS, A REAL TOTAL, AND FILTERS THAT REACH THE DATABASE. The search is the server's
   now, the paging is real, and the status dropdown carries counts so "what have I sold" is a
   question with a number beside it rather than one you answer by scrolling.

   THE FILTER OPTIONS COME FROM THE SERVER, never from the rows on screen. This is the rule the
   Product groups filter states and it matters more here: the options are computed against the
   filters in force minus their own, so the brand list still offers every brand you could switch to
   rather than collapsing to the one already chosen. Deriving them from a page of 50 would be worse
   still - it would offer only the brands that happen to be on screen.

   THE ROW OPENS THE RECORD. The bench that used to sit beside this table is gone; a unit's full
   record at /admin/assets/<id> is where its price, its photographs and its history live. The serial
   keeps its own link and stops the press from reaching the row underneath it, exactly as before. */

type Asset = {
  id: number; public_id: string; serial_number: string | null; status: string;
  grade: string | null; lot_number: string; model: string | null; title: string | null;
  brand: string | null; category: string | null; sale_price_cents: number | null;
  location: string | null; warehouse: string | null; zone: string | null;
};

type Facet = { value: string; count: number };

type Meta = {
  items: Asset[]; total: number; limit: number; offset: number;
  facets: { statuses: Facet[]; grades: Facet[]; categories: Facet[]; brands: Facet[]; warehouses: Facet[] };
};

/* How many units a page holds. The endpoint caps `limit` at 100, so this is the whole range. */
const PAGES = [25, 50, 100];

const SORTS = [
  { key: "newest", label: "Newest first" },
  { key: "oldest", label: "Oldest first" },
  { key: "price_high", label: "Price: high to low" },
  { key: "price_low", label: "Price: low to high" },
  { key: "serial", label: "Serial A-Z" },
];

/* Every filter this page sends. Kept as one object so "clear" is a single assignment and the URL
   reader and the fetch agree on the whole set rather than on whichever fields somebody remembered. */
type Filters = {
  status: string; q: string; category: string; brand: string; grade: string;
  warehouse: string; sort: string;
};
const NO_FILTERS: Filters = { status: "", q: "", category: "", brand: "", grade: "", warehouse: "", sort: "newest" };

export default function InventoryPage() {
  const router = useRouter();
  const [f, setF] = useState<Filters>(NO_FILTERS);
  /* The search box is local until Enter, so a five-letter serial is one request rather than five -
     the same bargain the Product groups search makes. These two are the committed values. */
  const [term, setTerm] = useState("");
  const [pageSize, setPageSize] = useState(50);
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<Meta | null>(null);
  const [err, setErr] = useState("");
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async (filters: Filters, off: number, size: number) => {
    setErr("");
    const p = new URLSearchParams({ with_meta: "1", limit: String(size), offset: String(off) });
    if (filters.status) p.set("status", filters.status);
    if (filters.q.trim()) p.set("q", filters.q.trim());
    if (filters.category) p.set("category", filters.category);
    if (filters.brand) p.set("brand", filters.brand);
    if (filters.grade) p.set("grade", filters.grade);
    if (filters.warehouse) p.set("warehouse", filters.warehouse);
    p.set("sort", filters.sort);
    const r = await apiFetch("/staff/assets?" + p.toString());
    if (!r.ok) {
      setErr(r.status === 403 ? "admin or manager role required" : "the inventory could not be read (" + r.status + ")");
      setData(null); setLoaded(true); return;
    }
    setData(await r.json());
    setLoaded(true);
  }, []);

  useEffect(() => { void load(f, offset, pageSize); }, [load, f, offset, pageSize]);

  /* THE QUERY IS ADDRESSABLE. The dashboard's stale-stock row links straight at the work it is
     about, and until this effect existed on the old page that link landed on the whole inventory -
     a narrowing that silently did nothing, which is worse than a plain link because it reads as
     though it worked. Read once on mount rather than through `useSearchParams`, which would put the
     page behind a Suspense boundary for a value that cannot change after load. */
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const next = { ...NO_FILTERS };
    for (const k of ["status", "q", "category", "brand", "grade", "warehouse"] as const) {
      const v = p.get(k);
      if (v) { (next as Record<string, string>)[k] = v; }
    }
    const s = p.get("sort");
    if (s && SORTS.some((x) => x.key === s)) { next.sort = s; }
    const off = Number(p.get("offset"));
    if (Number.isInteger(off) && off > 0) { setOffset(off); }
    setTerm(next.q);
    setF(next);
  }, []);

  /* Any filter change resets to the first page: staying on offset 100 of a result set that just
     became three rows long shows an empty table and reads as "no matches". */
  function apply(patch: Partial<Filters>) {
    setF((prev) => ({ ...prev, ...patch }));
    setOffset(0);
  }

  const total = data?.total ?? 0;
  const rows = data?.items ?? [];
  const facets = data?.facets;
  const statusCount = (v: string) => facets?.statuses.find((s) => s.value === v)?.count ?? 0;
  const filtered = f.status !== "" || f.category !== "" || f.brand !== "" || f.grade !== ""
    || f.warehouse !== "" || f.q.trim() !== "";

  return (
    <main className={pageClass.wide}>
      <PageHeader
        title={<>Inventory</>}
        description={
          <>Every unit the shop holds, in any state. Filter to what you are looking for, then open a
            unit for its full record.</>
        }
      />

      <section className="grid gap-4 sm:grid-cols-3">
        <Stat label="Units matching" value={total} sub={filtered ? "the current filters" : "everything in stock"} />
        <Stat label="Listed" value={statusCount("listed")} sub="on the shop" />
        <Stat label="Sold" value={statusCount("sold")} sub="all time" />
      </section>

      <Card className="p-4">
        {/* The filter bar. Widths go on WRAPPERS, never on the Input or Select: both carry `w-full`
            in their base and this app has no tailwind-merge, so a caller's width class loses to it
            by stylesheet order - see cn.ts. */}
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-60">
            <label className="block text-xs text-ink-500">Search</label>
            <Input value={term} placeholder="serial, sku, model, tag" type="search"
              aria-label="Search units by serial, sku, model or supplier tag"
              onChange={(e) => setTerm(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { apply({ q: term }); } }} />
          </div>
          <div>
            <label className="block text-xs text-ink-500">Status</label>
            <Select value={f.status} aria-label="Filter by status"
              onChange={(e) => apply({ status: e.target.value })}>
              <option value="">Any status</option>
              {(facets?.statuses ?? []).map((s) => (
                <option key={s.value} value={s.value}>{s.value} ({s.count})</option>
              ))}
            </Select>
          </div>
          <div>
            <label className="block text-xs text-ink-500">Category</label>
            <Select value={f.category} aria-label="Filter by category"
              onChange={(e) => apply({ category: e.target.value })}>
              <option value="">Every category</option>
              {(facets?.categories ?? []).map((s) => (
                <option key={s.value} value={s.value}>{s.value} ({s.count})</option>
              ))}
            </Select>
          </div>
          <div>
            <label className="block text-xs text-ink-500">Brand</label>
            <Select value={f.brand} aria-label="Filter by brand"
              onChange={(e) => apply({ brand: e.target.value })}>
              <option value="">Every brand</option>
              {(facets?.brands ?? []).map((s) => (
                <option key={s.value} value={s.value}>{s.value} ({s.count})</option>
              ))}
            </Select>
          </div>
          <div>
            <label className="block text-xs text-ink-500">Grade</label>
            <Select value={f.grade} aria-label="Filter by grade"
              onChange={(e) => apply({ grade: e.target.value })}>
              <option value="">Any grade</option>
              {(facets?.grades ?? []).map((s) => (
                <option key={s.value} value={s.value}>Grade {s.value} ({s.count})</option>
              ))}
            </Select>
          </div>
          <div>
            <label className="block text-xs text-ink-500">Warehouse</label>
            <Select value={f.warehouse} aria-label="Filter by warehouse"
              onChange={(e) => apply({ warehouse: e.target.value })}>
              <option value="">Any warehouse</option>
              {(facets?.warehouses ?? []).map((s) => (
                <option key={s.value} value={s.value}>{s.value} ({s.count})</option>
              ))}
            </Select>
          </div>
          <div>
            <label className="block text-xs text-ink-500">Sort</label>
            <Select value={f.sort} aria-label="Sort the table"
              onChange={(e) => apply({ sort: e.target.value })}>
              {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </Select>
          </div>
          <Button variant="secondary" size="sm" onClick={() => apply({ q: term })}>Search</Button>
          {filtered && (
            <Button variant="ghost" size="sm"
              onClick={() => { setTerm(""); setF(NO_FILTERS); setOffset(0); }}>
              Clear filters
            </Button>
          )}
        </div>

        {err && <p className="mt-3 text-sm text-danger-600">{err}</p>}

        <div className="mt-4">
          <Table label="Inventory">
            <THead>
              <TH>Serial</TH>
              <TH>Brand</TH>
              <TH>Model</TH>
              <TH>Category</TH>
              <TH>Grade</TH>
              <TH>Status</TH>
              <TH className="text-right">Price</TH>
              <TH>Location</TH>
              <TH>Lot</TH>
            </THead>
            <TBody>
              {rows.map((a) => (
                <TR key={a.id} tabIndex={0}
                  onClick={() => router.push("/admin/assets/" + a.id)}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget) { return; }
                    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); router.push("/admin/assets/" + a.id); }
                  }}
                  className={cn("cursor-pointer transition-colors duration-fast ease-out",
                    "hover:bg-surface-muted motion-reduce:transition-none",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-700")}>
                  <TD className="font-mono">
                    <span className="text-brand-300">{a.serial_number ?? "#" + a.id}</span>
                  </TD>
                  {/* A unit with no product is a real state - the importer can write one before the
                      catalogue knows the model - so every joined column has a fallback rather than a
                      blank cell that reads as a rendering fault. */}
                  <TD className="text-ink-600">{a.brand ?? "-"}</TD>
                  <TD className="truncate font-display text-ink-900">{a.model ?? a.title ?? "-"}</TD>
                  <TD className="text-ink-600">{a.category ?? "-"}</TD>
                  <TD>{a.grade ? <Badge colorClass={gradeTone(a.grade)}>{a.grade}</Badge> : <span className="text-ink-500">-</span>}</TD>
                  <TD><Badge colorClass={statusTone(a.status)}>{a.status}</Badge></TD>
                  <TD className="text-right">
                    {a.sale_price_cents === null ? <span className="text-ink-500">-</span> : aud(a.sale_price_cents)}
                  </TD>
                  <TD className="text-ink-600">{a.location ?? "-"}</TD>
                  <TD className="font-mono text-xs text-ink-600">{a.lot_number}</TD>
                </TR>
              ))}
              {loaded && rows.length === 0 && (
                <TR>
                  <TD colSpan={9} className="py-6 text-center text-sm text-ink-500">
                    {/* Two different facts, and saying the wrong one sends the operator looking for
                        stock that is there. */}
                    {filtered
                      ? "No unit matches these filters."
                      : "There is no stock yet."}
                  </TD>
                </TR>
              )}
            </TBody>
          </Table>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-ink-500">Rows per page</span>
            <Select value={String(pageSize)} aria-label="Rows per page"
              onChange={(e) => { setPageSize(Number(e.target.value)); setOffset(0); }}>
              {PAGES.map((n) => <option key={n} value={n}>{n}</option>)}
            </Select>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="secondary" size="sm" disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - pageSize))}>Previous</Button>
            <span className="text-xs text-ink-500">
              {total === 0 ? "nothing to show" : `${offset + 1}-${Math.min(offset + pageSize, total)} of ${total}`}
            </span>
            <Button variant="secondary" size="sm" disabled={offset + pageSize >= total}
              onClick={() => setOffset(offset + pageSize)}>Next</Button>
          </div>
        </div>
      </Card>
    </main>
  );
}
