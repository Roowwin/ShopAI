/* WHAT KIND OF THING THIS IS, as the shop should say it.

   Not every product in this catalogue is a graded refurbished machine, and until now the shop said
   they all were: a USB cable was offered as "Grade A - Like new", a Logitech mouse as "Grade C", and
   a replacement laptop screen as "Grade B" - because the schema keys a price on (brand, model,
   grade) and the importer gave every row a grade. The owner's own description of the business is
   what this file encodes:

     * ACCESSORIES - cables, keyboards, mice, bags, batteries, memory - are SOLD NEW.
     * PARTS - motherboards, screens - are SOLD IN WORKING CONDITION.
     * Everything else is a graded refurbished device, which is what the A-D ladder is for.

   AND THE GRADE IS NOT A DETAIL ON THOSE TWO GROUPS, IT IS MEANINGLESS. A new cable has no grade;
   a tested working system board has one condition. That is why this file returns nothing for a
   device (its grade ladder stands) and a condition for everything else - and why the product page
   stops asking those products' shoppers to choose a grade they cannot choose.

   DERIVED FROM THE CATEGORY, because that is where the fact already lives: the importer sets it,
   the API returns it, and no migration is needed to say something the catalogue already knows. It
   is also the honest place for it - the alternative was a per-product flag nobody would maintain,
   which would then drift away from the category it duplicates. A category this file does not know
   is treated as a graded device, which is the safe direction: the shop keeps its normal page rather
   than making a claim about an item nobody has classified. */

export type Condition = { label: string; note: string };

/* Matched on the category name, on letters and digits only, so "RAM (Memory)", "ram-memory" and
   "Keyboard & Mice" all land where they should. FIRST MATCH WINS, so the narrower words come first:
   "Laptop Bags" is an accessory and not a laptop, and "Monitors" is a graded device and must not be
   caught by the "screen" rule. */
const NEW_GOODS = ["cable", "keyboard", "mice", "mouse", "bag", "battery", "memory", "ram", "sodimm",
                   "charger", "headphone", "headset", "dock"];
const WORKING_PARTS = ["motherboard", "mainboard", "systemboard", "screen", "display", "panel"];

function core(category?: string | null): string {
  return (category ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** The condition to print for a category, or null when the product is a graded device. */
export function conditionFor(category?: string | null): Condition | null {
  const c = core(category);
  if (c === "") return null;
  for (const word of NEW_GOODS) {
    if (c.includes(word)) {
      return { label: "New",
            note: "New and unused - not a refurbished unit, so it carries no grade." };
    }
  }
  for (const word of WORKING_PARTS) {
    if (c.includes(word)) {
      return { label: "Working condition",
            note: "Pulled from a working machine and tested before it is listed - not a graded unit." };
    }
  }
  return null;
}
