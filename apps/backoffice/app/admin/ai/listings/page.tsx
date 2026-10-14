"use client";

import { useEffect, useState } from "react";
import { API, apiFetch } from "@/lib/api";
import { Card, Heading } from "@/app/components/ui";
import SearchEntry from "./SearchEntry";
import SourcePanel from "./SourcePanel";
import AiWorkspace from "./AiWorkspace";
import LivePreview from "./LivePreview";
import type { AssetDetail, CatalogItem, Vibe, Worklist, WorklistAsset } from "./types";
import { pageClass } from "@/lib/ui";

/* The AI Listing Studio: a search-first entry into a three-panel workspace.

   THE SHAPE. The old page was a catalogue dropdown beside a read-only copy card. Neither half
   matched the work: the operator has a UNIT in their hand (a serial, an asset id, a lot), not a
   product title they can recognise from a list, and the copy a human approves is copy they are
   allowed to correct. So the entry is a universal search, and the workspace puts the unit's facts
   (left) beside the drafting controls (centre) beside the storefront page as it will read (right).

   THE FOUR CALLS, ALL PRE-EXISTING. Nothing here is re-wired; three of the four are the doors this
   page already used, and the fourth is the universal search the Lot Process workstation uses:

     GET  /staff/lots/worklist?q=<term>   serial, asset id or lot number -> the lot, and the unit
     GET  /staff/assets/{id}              the unit's full record: notes and sale price
     POST /staff/ai/description-draft     { product_id, tone? }        -> { title, description, keywords }
     POST /staff/products/{pid}/listing   { title, description }       -> replaces the product's copy
     POST /staff/assets/{aid}/status      { status: "listed" }         -> the unit goes live

   The only backend change this page needed was the optional `tone` on the description draft - the
   one thing the vibe switcher could not be built against otherwise. Everything else is a
   rearrangement of doors that already existed.

   PUBLISH IS TWO WRITES AND IS REPORTED AS TWO. The copy belongs to the PRODUCT and the listing
   belongs to the UNIT, so the press performs both and prints each one's own result rather than a
   single word that would hide a half-done press. The copy is attempted first and a failure there
   stops the sequence: the listing is the thing being approved, and walking a unit to `listed`
   without the approved copy on its product is not what the press meant. If the copy lands and the
   status is refused (a `sales` identity has no listing rights on the status door; a unit with no
   sale price is refused by the database; a unit that is not `graded` is refused by the ladder) the
   operator is told exactly that, and the panel re-reads the unit so it shows its real state.

   THE `?asset=` HANDOFF STILL WORKS, and it is now the same code path as a typed search. The asset
   studio's Generate Listing CTA arrives with a unit id; this page feeds that id to the SAME
   resolution rule the search box uses and opens the studio on the unit it names. One rule, so a
   handoff and a hand-typed id can never resolve differently.

   It reads `window.location.search` in an effect rather than `useSearchParams()` on purpose: this
   page is statically rendered, and the hook would require a Suspense boundary it has no use for.
   Read once, at mount - the query string is an arrival, not state. */

/** The API's own sentence for a refusal, so a 409 reads as the database's reason and not "409". */
async function refusal(r: Response): Promise<string> {
  const j: any = await r.json().catch(() => null);
  const d = j?.detail;
  return typeof d === "string" && d !== "" ? d : String(r.status);
}

export default function ListingsPage() {
  /* The catalogue is the PRODUCT side of every panel: brand, model, specs, category. Read once -
     it is the same public door the old picker was filled from, and nothing on this page writes it. */
  const [cat, setCat] = useState<CatalogItem[]>([]);

  /* Entry state. */
  const [term, setTerm] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState("");
  const [result, setResult] = useState<Worklist | null>(null);

  /* Studio state. `unit` non-null is what puts the page in the studio rather than the entry. */
  const [unit, setUnit] = useState<WorklistAsset | null>(null);
  const [detail, setDetail] = useState<AssetDetail | null>(null);

  /* The editable copy. `drafted` distinguishes "nothing asked for yet" from "a draft came back
     empty", which the two would otherwise share a representation. */
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [keywords, setKeywords] = useState<string[]>([]);
  const [vibe, setVibe] = useState<Vibe | null>(null);
  const [drafted, setDrafted] = useState(false);

  const [generating, setGenerating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [messages, setMessages] = useState<string[]>([]);

  useEffect(() => {
    fetch(API + "/store/catalog?limit=100", { credentials: "include" })
      .then(async (r) => { if (r.ok) setCat(await r.json()); })
      .catch(() => { /* the panels fall back to the worklist's own product fields */ });
  }, []);

  async function runSearch(raw: string): Promise<Worklist | null> {
    const t = raw.trim();
    if (t === "") return null;
    setSearching(true); setSearchErr(""); setResult(null);
    try {
      const r = await apiFetch("/staff/lots/worklist?q=" + encodeURIComponent(t));
      if (r.ok) {
        const j: Worklist = await r.json();
        setResult(j);
        return j;
      }
      if (r.status === 404) setSearchErr("Nothing matches that lot number, asset ID or serial.");
      else if (r.status === 403) setSearchErr("Searching stock needs the admin or manager role.");
      else setSearchErr("Search failed: " + (await refusal(r)));
      return null;
    } catch {
      setSearchErr("Search failed - the API did not answer.");
      return null;
    } finally {
      setSearching(false);
    }
  }

  /** Open the studio on one unit. The product is resolved from the catalogue already in memory. */
  function openStudio(u: WorklistAsset, wl: Worklist) {
    setUnit(u);
    setDetail(null);
    setDrafted(false);
    setVibe(null);
    setKeywords([]);
    setMessages([]);
    /* The title starts as the product's CURRENT title rather than blank: it is a real fact about
       the record, and starting from it means the preview reads like the real page from the first
       keystroke. The description has no such fact available without a second read, so it starts
       empty and the preview says so. */
    const p = cat.find((c) => c.id === u.product_id) ?? null;
    setTitle(p?.title ?? "");
    setDescription("");
    setResult(wl);
    apiFetch("/staff/assets/" + u.id)
      .then(async (r) => {
        if (!r.ok) return;
        const j: any = await r.json().catch(() => null);
        if (j?.asset) setDetail(j.asset);
      })
      .catch(() => { /* the worklist row carries enough for the panels to stand */ });
  }

  /* The handoff. `?asset=<id>` is a unit id, and it is resolved through the SAME rule the search box
     uses (the worklist door reads a bare number as an asset id), so a handoff and a typed id cannot
     resolve differently. A refused or stale id leaves the entry as it was - this is an opening move,
     not a wall - and a handoff that resolves opens the studio on the unit it named. */
  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get("asset");
    if (!raw) return;
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) return;
    setTerm(String(id));
    void runSearch(String(id)).then((wl) => {
      if (!wl) return;
      const u = wl.highlight_asset_id != null
        ? wl.assets.find((a) => a.id === wl.highlight_asset_id) ?? null
        : null;
      if (u) openStudio(u, wl);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function generate(v: Vibe | null) {
    if (unit?.product_id == null) return;
    setVibe(v); setGenerating(true); setMessages([]);
    try {
      const r = await apiFetch("/staff/ai/description-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(v ? { product_id: unit.product_id, tone: v } : { product_id: unit.product_id }),
      });
      if (r.ok) {
        const d: any = await r.json();
        setTitle(d.title ?? "");
        setDescription(d.description ?? "");
        setKeywords(Array.isArray(d.keywords) ? d.keywords : []);
        setDrafted(true);
      } else {
        setMessages(["Draft failed: " + (await refusal(r))]);
      }
    } catch {
      setMessages(["Draft failed - the API did not answer."]);
    } finally {
      setGenerating(false);
    }
  }

  async function publish() {
    if (unit == null) return;
    setPublishing(true); setMessages([]);
    const out: string[] = [];
    try {
      if (unit.product_id == null) {
        out.push("No copy written: this unit has no product linked, so there is nothing to title.");
      } else {
        const r1 = await apiFetch("/staff/products/" + unit.product_id + "/listing", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, description }),
        });
        if (!r1.ok) {
          out.push("Copy not written: " + (await refusal(r1)));
          setMessages(out);
          return;   // the approved copy is the point of the press - do not list without it
        }
        out.push("Listing copy written to product " + unit.product_id + " (replaced values are in the audit record).");
      }

      const r2 = await apiFetch("/staff/assets/" + unit.id + "/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "listed" }),
      });
      if (r2.ok) {
        out.push("Unit " + unit.id + " is now listed - the storefront shows it while its lot is active.");
        // Re-read the unit so the panels report the state the database actually holds now.
        const rr = await apiFetch("/staff/assets/" + unit.id);
        if (rr.ok) {
          const j: any = await rr.json().catch(() => null);
          if (j?.asset) setDetail(j.asset);
        }
      } else {
        out.push("Unit not listed: " + (await refusal(r2)) +
                 " - the copy above is written, but the unit is not on the storefront.");
      }
    } catch {
      out.push("Publish failed - the API did not answer. Check the unit before pressing again.");
    } finally {
      setMessages(out);
      setPublishing(false);
    }
  }

  const product = unit ? cat.find((c) => c.id === unit.product_id) ?? null : null;

  if (unit === null || result === null) {
    return (
      <main className={pageClass.narrow}>
        <SearchEntry
          term={term}
          onTerm={setTerm}
          onSearch={() => { void runSearch(term); }}
          searching={searching}
          error={searchErr}
          result={result}
          onOpen={(u) => openStudio(u, result as Worklist)}
        />
      </main>
    );
  }

  return (
    <main className={pageClass.narrow}>
      <div>
        <Heading level="h1">AI Listing Studio</Heading>
        <p className="mt-1 text-sm text-ink-500">
          Drafting about{" "}
          <span className="text-ink-700">{product?.title ?? unit.product_title ?? "unit " + unit.id}</span>{" "}
          <span className="font-mono text-xs">({unit.serial_number ?? unit.public_id})</span> - from lot{" "}
          <span className="font-mono text-xs">{result.lot.lot_number}</span>.
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="p-6">
          <SourcePanel
            unit={unit}
            detail={detail}
            product={product}
            lot={result}
            onBack={() => { setUnit(null); setDetail(null); setMessages([]); }}
          />
        </Card>

        <Card className="p-6">
          <AiWorkspace
            productId={unit.product_id}
            title={title}
            description={description}
            keywords={keywords}
            vibe={vibe}
            generating={generating}
            publishing={publishing}
            drafted={drafted}
            onTitle={setTitle}
            onDescription={setDescription}
            onGenerate={(v) => { void generate(v); }}
            onPublish={() => { void publish(); }}
            messages={messages}
          />
        </Card>

        <Card className="p-6">
          <LivePreview
            title={title}
            description={description}
            product={product}
            unit={unit}
            detail={detail}
            lot={result}
          />
        </Card>
      </div>
    </main>
  );
}
