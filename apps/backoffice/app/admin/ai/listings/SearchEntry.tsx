"use client";

import { Badge, Button, Card, Heading, Input } from "@/app/components/ui";
import { kickerClass, statusTone } from "@/lib/ui";
import type { Worklist, WorklistAsset } from "./types";

/* The studio's front door: one search box, and the identity of whatever it resolved.

   THERE IS NO PRODUCT PICKER. The old page offered a dropdown of the catalogue, which asked the
   operator to recognise a product by its TITLE - and the thing in their hand is a unit, labelled
   with a serial, an asset id, or the lot it came in on. So the entry is a search that takes any of
   the three, and the resolution rule is not written here: it is `GET /staff/lots/worklist`, the
   same universal search the Lot Process workstation already uses (lot number, then a bare number
   as an asset id, then the serial). Reusing that door is the point - a second search that resolved
   the same three things by its own rules is a second set of rules to keep in step, and the two
   would answer differently the first time they were edited apart.

   WHAT COMES BACK IS A LOT, ALWAYS. The worklist door reports a match as a door into its lot and
   names the matched unit separately in `highlight_asset_id`. This card keeps that shape rather
   than flattening it: a term that named a UNIT shows that unit's identity and opens the studio on
   it, and a term that named a LOT lists the lot's units, because the operator who searched a lot
   number has not yet said which unit they mean. `match.resolved_by` is drawn, not swallowed - a
   search that silently picks one reading of an ambiguous term is a search whose answer nobody can
   check. */

const LINE = "flex items-baseline justify-between gap-4 py-1";

function UnitRow({ unit, onOpen }: { unit: WorklistAsset; onOpen: (u: WorklistAsset) => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(unit)}
        className="flex w-full items-center justify-between gap-4 rounded-control px-3 py-2 text-left ring-1 ring-line transition duration-fast hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700"
      >
        <span className="min-w-0">
          <span className="block truncate text-sm text-ink-900">
            {unit.product_title ?? "unit " + unit.id + " (no product linked)"}
          </span>
          <span className="block truncate font-mono text-xs text-ink-500">
            {unit.serial_number ?? unit.public_id}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {unit.grade && (
            <Badge colorClass="bg-surface-sunken text-ink-600">Grade {unit.grade}</Badge>
          )}
          <Badge colorClass={statusTone(unit.status)}>{unit.status}</Badge>
        </span>
      </button>
    </li>
  );
}

export default function SearchEntry({ term, onTerm, onSearch, searching, error, result, onOpen }: {
  term: string;
  onTerm: (v: string) => void;
  /** the page's own search press - this card only hands the press on */
  onSearch: () => void;
  searching: boolean;
  /** the page's own refusal line, shown verbatim: a 404 and a 403 mean different things here */
  error: string;
  result: Worklist | null;
  /** open the studio on one unit */
  onOpen: (unit: WorklistAsset) => void;
}) {
  const highlighted = result && result.highlight_asset_id != null
    ? result.assets.find((a) => a.id === result.highlight_asset_id) ?? null
    : null;

  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center pt-16 pb-12">
      <Heading level="h1" className="text-center">AI Listing Studio</Heading>
      <p className="mt-2 max-w-md text-center text-sm text-ink-500">
        Find the unit you are about to write about - by serial number, asset ID, or lot number.
        Drafts use verified product facts only, and nothing publishes until you press publish.
      </p>

      <form
        className="mt-8 flex w-full items-stretch gap-2"
        onSubmit={(e) => { e.preventDefault(); onSearch(); }}
      >
        <Input
          value={term}
          onChange={(e) => onTerm(e.target.value)}
          placeholder="Serial, asset ID or lot number"
          aria-label="Search by serial, asset ID or lot number"
          autoFocus
        />
        <Button type="submit" disabled={searching || term.trim() === ""} className="shrink-0">
          {searching ? "Searching..." : "Search"}
        </Button>
      </form>

      {/* The refusal, when there is one. 404 ("nothing matches") and 403 ("this needs the admin or
          manager role") are different facts about the term and the session, so the message the page
          built is printed as it stands rather than replaced with a generic one. */}
      {error !== "" && (
        <p className="mt-6 w-full rounded-control bg-surface-sunken px-4 py-3 text-sm text-ink-600 ring-1 ring-line">
          {error}
        </p>
      )}

      {result !== null && error === "" && (
        <Card className="mt-6 w-full p-6">
          <div className="flex items-baseline justify-between gap-4">
            <p className={kickerClass}>Product identity</p>
            <p className="text-xs text-ink-500">
              matched by {result.match.resolved_by.replace("_", " ")}
              {result.match.term ? " · \"" + result.match.term + "\"" : ""}
            </p>
          </div>

          <dl className="mt-3 text-sm">
            <div className={LINE}>
              <dt className="text-ink-500">Lot</dt>
              <dd className="font-mono text-ink-700">{result.lot.lot_number}</dd>
            </div>
            <div className={LINE}>
              <dt className="text-ink-500">Lot status</dt>
              <dd><Badge colorClass={statusTone(result.lot.status)}>{result.lot.status}</Badge></dd>
            </div>
            <div className={LINE}>
              <dt className="text-ink-500">Lot progress</dt>
              <dd className="tabular-nums text-ink-700">
                {result.progress.graded_units} of {result.progress.total_units} graded
              </dd>
            </div>
          </dl>

          {highlighted ? (
            <>
              <div className="mt-4 border-t border-line pt-4">
                <p className="text-sm font-semibold text-ink-900">
                  {highlighted.product_title ?? "unit " + highlighted.id + " (no product linked)"}
                </p>
                <dl className="mt-2 text-sm">
                  <div className={LINE}>
                    <dt className="text-ink-500">Brand / model</dt>
                    <dd className="text-ink-700">
                      {highlighted.product_model ?? "-"}
                      {highlighted.category ? " · " + highlighted.category : ""}
                    </dd>
                  </div>
                  <div className={LINE}>
                    <dt className="text-ink-500">Serial</dt>
                    <dd className="font-mono text-ink-700">{highlighted.serial_number ?? "-"}</dd>
                  </div>
                  <div className={LINE}>
                    <dt className="text-ink-500">Grade</dt>
                    <dd className="text-ink-700">{highlighted.grade ?? "not graded"}</dd>
                  </div>
                  <div className={LINE}>
                    <dt className="text-ink-500">Unit status</dt>
                    <dd><Badge colorClass={statusTone(highlighted.status)}>{highlighted.status}</Badge></dd>
                  </div>
                </dl>
              </div>
              <div className="mt-4">
                <Button onClick={() => onOpen(highlighted)}>Open Studio</Button>
              </div>
            </>
          ) : (
            <>
              <p className="mt-4 border-t border-line pt-4 text-xs text-ink-500">
                A lot number names a box of units, not one of them - pick the unit you are listing:
              </p>
              <ul className="mt-3 space-y-2">
                {result.assets.map((a) => <UnitRow key={a.id} unit={a} onOpen={onOpen} />)}
              </ul>
              {result.assets.length === 0 && (
                <p className="mt-3 text-sm text-ink-400">This lot has no units on it.</p>
              )}
              {result.truncated && (
                <p className="mt-3 text-xs text-ink-500">
                  Showing the first {result.limit} units of this lot; there are more.
                </p>
              )}
            </>
          )}
        </Card>
      )}
    </div>
  );
}
