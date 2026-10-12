"use client";

import { useEffect, useState } from "react";
import { API, apiFetch } from "@/lib/api";
import { Card, Heading } from "@/app/components/ui";
import ProductContext, { type CatalogItem } from "./ProductContext";
import GeneratedCopy, { type Draft } from "./GeneratedCopy";

/* The AI listing studio: the product and its own facts on one side, the copy the model wrote on
   the other.

   THE TWO WORKING CALLS ARE UNCHANGED. `draftIt` and `approve` below are the ones this page has
   always had - the same bodies, the same guard clauses, the same message strings, the same
   endpoints. The two columns wrap them; nothing re-wires them:

     POST /staff/ai/description-draft    body { product_id }         -> { title, description, keywords }
     POST /staff/products/{pid}/listing  body { title, description }  -> replaces the product's copy

   Both shapes are read off the handlers rather than inferred. The draft call takes a product id
   and nothing else - there is no tone parameter on it anywhere - and it writes nothing at all: it
   reads the product and its grades and returns a draft. The publish call updates the product row
   in place, so an existing title and description IS overwritten, and the values it replaces plus
   the new title go into the audit record in the same transaction.

   WHAT CHANGED IS THE FRAME. The old page was one narrow column with a picker, a press and a
   result card under it. This one puts the product's facts beside the copy, which is the pair a
   reader actually has to compare - and that is why each column names the product it is about
   rather than letting a split view imply the two are always one record.

   NOTHING ELSE MOVED: no route, no request, no parameter, no dependency, and no change anywhere
   under apps/backend.

   ONE DOOR IN, AND IT IS THE ASSET STUDIO'S. `?asset=<id>` is how the unit page hands a unit over:
   the studio's Generate Listing CTA links here with the unit it was pressed on, and this page
   resolves that unit to its PRODUCT - this page drafts about products, because that is what the
   two AI calls above take. The resolution is one read of the same asset door the studio just read,
   and it only ever PRESELECTS: no draft is written, nothing is published, and the picker stays
   usable, so a bad or stale id costs a pick rather than a page.

   It reads `window.location.search` in an effect rather than `useSearchParams()` on purpose: this
   page is statically rendered, and the hook would require a Suspense boundary it has no use for.
   Read once, at mount - the query string is an arrival, not state, and re-reading it on every
   render would be a way for a later navigation to yank the picker out from under a draft. */

export default function ListingsPage() {
  const [cat, setCat] = useState<CatalogItem[]>([]);
  const [pid, setPid] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  /* The unit that handed over, kept as the picker's opening move and as the reason line above the
     columns. A label, not a guard: nothing here depends on it. */
  const [handoff, setHandoff] = useState<number | null>(null);

  /* WHICH PRODUCT THE SHOWN DRAFT BELONGS TO. The draft body carries the id chosen when that press
     was made, while the picker beside it shows the id chosen NOW - the picker stays usable while a
     call is out and after one lands. Recording the product at the press is what lets the copy
     column name the product its draft came from instead of assuming it is whatever the picker
     shows later.

     This is a LABEL, not a guard: it reads nothing, blocks nothing, and no request, guard or
     message on this page depends on it. */
  const [draftFor, setDraftFor] = useState<CatalogItem | null>(null);

  useEffect(() => {
    fetch(API + "/store/catalog", { credentials: "include" }).then(async (r) => { if (r.ok) setCat(await r.json()); });
  }, []);

  /* The handoff. The asset id arrives in the query string; the product the page works with is
     resolved through the same /staff/assets door the studio reads. A 403 or a stale id leaves the
     picker exactly as it was - this is an opening move, not a wall. */
  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get("asset");
    if (!raw) return;
    const assetId = Number(raw);
    if (!Number.isInteger(assetId) || assetId <= 0) return;
    setHandoff(assetId);
    apiFetch("/staff/assets/" + assetId)
      .then(async (r) => {
        if (!r.ok) return;
        const j: any = await r.json().catch(() => null);
        if (j?.asset?.product_id != null) setPid(j.asset.product_id);
      })
      .catch(() => { /* the picker is still there; that is the fallback */ });
  }, []);

  async function draftIt() {
    if (pid == null) return;
    setBusy(true); setMsg(""); setDraft(null);
    const r = await apiFetch("/staff/ai/description-draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ product_id: pid }) });
    if (r.ok) setDraft(await r.json()); else { const j: any = await r.json().catch(() => ({})); setMsg("error: " + (j.detail ?? r.status)); }
    setBusy(false);
  }

  async function approve() {
    if (!draft || pid == null) return;
    setBusy(true);
    const r = await apiFetch("/staff/products/" + pid + "/listing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: draft.title, description: draft.description }) });
    setMsg(r.ok ? "PUBLISHED (audit-logged). Refresh the storefront product page to see it." : ("error: " + r.status));
    setBusy(false);
  }

  const selected = cat.find((c) => c.id === pid) ?? null;

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 pt-8 pb-16">
      <div>
        <Heading level="h1">AI listings (human-approved)</Heading>
        <p className="mt-1 text-sm text-ink-500">
          Drafts use verified product facts only - you approve before anything publishes (ACCC-safe
          wording rule).
        </p>
        {handoff !== null && (
          <p className="mt-1 text-xs text-ink-500">
            Handed over from asset <span className="font-mono">{handoff}</span>
            {selected ? <> &middot; drafting about <span className="text-ink-600">{selected.title}</span></>
                       : " - pick the product it belongs to below."}
          </p>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <ProductContext
            items={cat}
            pid={pid}
            onPick={setPid}
            onGenerate={() => { setDraftFor(selected); draftIt(); }}
            busy={busy}
          />
        </Card>

        <Card className="p-6">
          <GeneratedCopy
            draft={draft}
            draftFor={draftFor}
            busy={busy}
            onSave={approve}
          />
        </Card>
      </div>

      {msg && <p className="text-sm text-ink-600">{msg}</p>}
    </main>
  );
}
