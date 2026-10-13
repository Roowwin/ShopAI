"""The margin guard: one business rule, enforced at four layers.

THE RULE. A unit is a **loss-maker** when its resale price is BELOW what it cost us
(``sale_price_cents < cost_cents``). At cost is not a loss - it is zero margin, which the owner may
run deliberately - so only "below" is refused. An UNKNOWN cost (NULL) is never a loss: it is the
absence of the fact, not the claim that the unit was free, and reading it as zero would hide every
unit whose cost nobody has entered yet.

WHY ONE MODULE. The rule is enforced in four places that must never disagree:

  1. the importer    - a row priced below its cost is BLOCKED, whole file (``staff_imports``)
  2. the staff doors - pricing or listing a loss-maker is REFUSED (``staff_ops``)
  3. the checkout    - a loss-maker cannot be bought even by a crafted request (``store_ops``)
  4. the storefront  - a loss-maker VANISHES from the shop (``store_catalog``)

Written four times the rule would drift, and the drift would be a unit the shop keeps selling that
the staff side believes it refused. The Python predicate and the SQL predicate below are the same
rule written twice only because one runs in Python and one in the database; they live together here
so a change to one is visibly a change to its twin.
"""


def is_loss_maker(sale_price_cents: int | None, cost_cents: int | None) -> bool:
    """True when the price is known to be below the cost. Unknown cost is never a loss."""
    return (sale_price_cents is not None and cost_cents is not None
            and sale_price_cents < cost_cents)


def margin_refusal(sale_price_cents: int | None, cost_cents: int | None) -> str | None:
    """The operator-facing sentence for a loss-maker, or None when the unit is fine.

    One sentence, from one place, so the importer's row issue and the staff door's 422 read the same.
    """
    if not is_loss_maker(sale_price_cents, cost_cents):
        return None
    return (f"resale price {sale_price_cents} is below cost {cost_cents} - "
            "listing this unit would sell at a loss")


# The rule as a predicate on the `assets` alias `a`, stated on the ALLOW side: a unit with no known
# cost, or a cost at or below its price, is publishable. The allow form (rather than
# "NOT loss-maker") is what keeps the catalog's own statement-shape tests readable, and a null cost
# flowing through it is exactly the "unknown is not zero" rule above.
PUBLISHABLE_SQL = "(a.cost_cents IS NULL OR a.cost_cents <= a.sale_price_cents)"
