/* THE SUPPLIER SHEET'S AUDIT LINE, REFORMATTED.

   The line the sheet carries is a comma-separated run - "No, COA Windows 10, 13th Gen - Raptor Lake,
   1335U, Core i5, 1.3 GHz, LPDDR5, 16GB, Western Digital 256GB NVMe" - in which the things a buyer
   actually wants to know (which processor, how much memory, how big the drive) are buried among the
   licence and the generation. This does NOT interpret anything: it SORTS the sheet's own pieces into
   named rows and joins the ones that belong together, so the page can print "Processor: Core i5 ·
   1335U" instead of a sentence.

   NOTHING IS INVENTED AND NOTHING IS DROPPED. A piece this file does not recognise is not guessed at -
   it is carried out under "Also recorded" and printed verbatim, and a line with no recognisable piece
   at all (a cable's "N/A Non-Data Bearing Asset, High Speed 4K DisplayPort to HDMI 2 Meter Cable")
   falls back to the whole sentence. A wrong spec on a product page is the one error here a customer
   would act on, so the safe direction is to show the sheet's words, not to summarise them. */

export type SheetRow = { label: string; value: string };

type Bucket = "os" | "generation" | "processor" | "speed" | "memory" | "storage" | "display";

/* Speed and generation are matched before processor and storage: "1.3 GHz" and "13th Gen" belong to
   neither of the others, and a loose storage pattern would swallow a memory size. */
const PATTERNS: [Bucket, RegExp][] = [
  ["speed", /\d+(\.\d+)?\s?GHz/i],
  ["generation", /\d+\s?th\s?Gen|[A-Z][a-z]+\sLake\b|\bZen\s?\d\b/i],
  ["processor", /\b(core\s?i[3579]|pentium|celeron|ryzen|xeon|snapdragon|apple\s?m\d|atom)\b/i],
  ["os", /windows\s?\d+|macos|chrome\s?os|android|\bios\b|ipados|carrier unlocked|standard (build|image)/i],
  ["storage", /\b\d+\s?(GB|TB)\b\s*(SSD|NVMe|HDD|eMMC|Flash)\b|western digital|seagate|kingston|sk hynix|micron|toshiba/i],
  ["display", /\d{3,4}\s?[xX]\s?\d{3,4}|\bFHD\b|\bIPS\b|\bLCD\b|\bTouch\b|\d{2}(\.\d)?"/i],
];

const LABELS: Record<Bucket, string> = {
  processor: "Processor", generation: "Generation", speed: "Speed", memory: "Memory",
  storage: "Storage", display: "Display", os: "Operating system",
};

// The order the rows are read in: what it is, then how fast, then what it holds, then what it runs.
const ORDER: Bucket[] = ["processor", "generation", "speed", "memory", "storage", "display", "os"];

/* TWO THINGS THE SHEET SAYS THAT THE PAGE DOES NOT (owner, 2026-10-16):
     * THE OPERATING SYSTEM ROW IS GONE - the whole bucket, not the wording. The sheet's piece is the
       licence the unit ARRIVED with ("COA Windows 10", "COA Standard Build", "COA Carrier Unlocked"),
       and the shop installs a new operating system on every machine, which the "Included" row states
       in one line. Printing both put two answers to one question side by side.
     * THE DRIVE'S MAKE IS STRIPPED from the storage row: "Western Digital 256GB NVMe" reads
       "256GB NVMe". The supplier's sourcing detail is not something a buyer chooses between, and the
       capacity and the interface are. */
const STORAGE_BRANDS = /\b(western digital|sandisk|seagate|kingston|sk hynix|hynix|micron|crucial|toshiba|samsung|intel)\b/gi;

const drop = (value: string) => value.replace(STORAGE_BRANDS, "").replace(/\s{2,}/g, " ").trim();

const SIZE = /^\d+\s?(GB|TB)$/i;              // a bare capacity, belonging to whatever is beside it
const MEM_TYPE = /\b(LPDDR\d?|DDR\d|SODIMM|RAM)\b/i;
/* "1335U" - the processor's own number, on a piece of its own in the laptop line. THE CAPACITY TEST IS
   NOT OPTIONAL: "128GB" is three digits and two letters, so a bare shape match read a phone's STORAGE
   as its PROCESSOR and the page offered "Processor: 128GB". "GB" and "TB" are never a chip's suffix. */
const CPU_MODEL = /^[0-9]{3,5}[A-Z]{1,2}$/;
const isCpuModel = (piece: string) => CPU_MODEL.test(piece) && !/^(GB|TB)$/i.test(piece.slice(-2));

/** A phone or a tablet - the one kind of machine the shop does NOT install an operating system on. */
export function isPhoneOrTablet(category?: string | null): boolean {
  return /phone|tablet|ipad|mobile/i.test(String(category ?? ""));
}

/** The sheet's line as labelled rows. `rest` is every piece nothing matched; `rows` may be empty.
    `keepOs` asks for the operating-system row as well - only a phone or a tablet has a use for it. */
export function parseAudit(text?: string | null, opts: { keepOs?: boolean } = {}): { rows: SheetRow[]; rest: string[] } {
  const pieces = String(text ?? "").split(/,\s*/).map((p) => p.trim()).filter(Boolean);
  // "No" / "N/A" is the sheet's own licence flag, not a spec.
  const spec = pieces.filter((p) => !/^(no|n\/a|yes)$/i.test(p));

  /* MEMORY IS TWO PIECES, NOT ONE. The sheet writes the type and the size apart - "LPDDR5, 16GB" - so a
     pattern wanting both in one piece matched neither, and the size fell through to STORAGE: a 16GB
     laptop was printed as having a 16GB drive. The type piece claims the capacity beside it, and only
     a capacity nobody claims is treated as storage - which is what makes the phone line ("64GB,
     Midnight") read as 64GB of storage, there being no memory type to claim it. */
  const claimed = new Set<number>();
  const buckets = new Map<Bucket, string[]>();
  const push = (b: Bucket, v: string) => buckets.set(b, [...(buckets.get(b) ?? []), v]);
  spec.forEach((piece, i) => {
    if (!MEM_TYPE.test(piece)) { return; }
    claimed.add(i);
    push("memory", piece);
    for (const j of [i - 1, i + 1]) {
      if (j >= 0 && j < spec.length && SIZE.test(spec[j])) { claimed.add(j); push("memory", spec[j]); }
    }
  });

  const rest: string[] = [];
  spec.forEach((piece, i) => {
    if (claimed.has(i)) { return; }
    if (isCpuModel(piece)) { push("processor", piece); return; }
    if (SIZE.test(piece)) { push("storage", piece); return; }
    const hit = PATTERNS.find(([, re]) => re.test(piece));
    if (!hit) { rest.push(piece); return; }
    push(hit[0], piece);
  });

  return {
    rows: ORDER.filter((b) => buckets.has(b) && (b !== "os" || opts.keepOs))
      .map((b) => ({
        label: LABELS[b],
        value: buckets.get(b)!.map((v) => (b === "storage" ? drop(v) : v)).filter(Boolean).join(" · "),
      }))
      .filter((r) => r.value !== ""),
    rest,
  };
}

/** True when the sheet's line described no spec at all - a cable, a bag, a battery. */
export function auditIsDescriptive(text?: string | null): boolean {
  return /non-data bearing asset/i.test(String(text ?? ""));
}

/* WHAT SHIPS WITH EVERY COMPUTER, IN THE SHOP'S OWN WORDS.

   THIS IS NOT PARSED FROM THE SHEET AND MUST NOT BE. Every other row in this file is the supplier's
   own sentence re-sorted; this one is the operator's stated policy for what a machine leaves the
   building with, which is a different kind of claim and is recorded as such. It is deliberately one
   constant in one place rather than a line repeated into 75 product records, so that correcting it is
   a single edit.

   IT APPLIES TO COMPUTERS ONLY - a laptop, a desktop, a thin client. A monitor, a switch, a phone and
   a tablet do not run Windows, and putting an operating system on them would be the exact kind of
   wrong spec the rest of this file is written to avoid. */
export const INCLUDED_WITH_COMPUTERS = "Brand new Windows 11 Pro";

/** Whether this category is a machine that runs an operating system at all. */
export function isComputer(category?: string | null): boolean {
  return /laptop|desktop|thin/i.test(String(category ?? ""));
}
