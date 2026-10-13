"""The margin guard: one business rule, enforced at four layers.

THE RULE. A unit is a **loss-maker** when its resale price is below its COST BASIS. At cost is not a
loss - it is zero margin, which the owner may run deliberately - so only "below" is refused. An
UNKNOWN cost is never a loss: it is the absence of the fact, not the claim that the unit was free,
and reading it as zero would hide every unit whose cost nobody has entered.

THE COST BASIS IS ``COALESCE(cost_cents, settlement_cents)``. `cost_cents` is the schema's canonical
cost; a supplier workbook's Settlement is the same fact for stock that arrived on a sheet. Reading
them as one number, in that order, is what the storefront floor already does - so the guard that
lets a unit be LISTED and the guard that PUBLISHES it cannot disagree about whether it is a loss.

FOUR LAYERS, ONE DEFINITION.

  1. the importer    - a row priced below its basis is BLOCKED, whole file (``staff_imports``)
  2. the staff doors  - pricing or listing a loss-maker is REFUSED (``staff_ops``)
  3. the checkout     - a loss-maker cannot be bought even by a crafted request (``store_ops``)
  4. the storefront   - a loss-maker VANISHES from the shop (``store_catalog``, via ``ON_SALE``)

``ON_SALE`` is the same rule written as a SQL predicate on the `assets` alias `a`, spliced into the
storefront's statements from here, so the shop and the Python guards above share one definition
rather than four that drift apart. The Python predicate and the SQL predicate are the same rule
written twice only because one runs in Python and one in the database; they live together so a
change to one is visibly a change to its twin.
"""


def cost_basis(cost_cents: int | None, settlement_cents: int | None) -> int | None:
    """The one number "what it cost" means: the recorded cost, else the supplier's settlement."""
    return cost_cents if cost_cents is not None else settlement_cents


def is_loss_maker(sale_price_cents: int | None, cost_cents: int | None,
                  settlement_cents: int | None = None) -> bool:
    """True when the price is known to be below the basis. An unknown basis is never a loss."""
    basis = cost_basis(cost_cents, settlement_cents)
    return sale_price_cents is not None and basis is not None and sale_price_cents < basis


def margin_refusal(sale_price_cents: int | None, cost_cents: int | None,
                   settlement_cents: int | None = None) -> str | None:
    """The operator-facing sentence for a loss-maker, or None when the unit is fine.

    One sentence, from one place, so the importer's row issue and the staff doors' 422 read alike.
    """
    if not is_loss_maker(sale_price_cents, cost_cents, settlement_cents):
        return None
    basis = cost_basis(cost_cents, settlement_cents)
    return (f"resale price {sale_price_cents} is below cost {basis} - "
            "listing this unit would sell at a loss")


# The rule as a predicate on the `assets` alias `a`, on the ALLOW side: a unit with no known cost
# basis, or a basis at or below its price, is publishable. Written on the allow side (rather than as
# "NOT loss-maker") because that is the shape the storefront statements splice, and because a null
# basis flowing through it is exactly the "unknown is not zero" rule above. The leading and trailing
# spaces are part of the literal, not sloppiness: it lands mid-statement in some call sites and after
# a newline in others, and one of the two separators is always the right one - without them a splice
# produces `'active')AND (`, which parses but reads as a defect.
ON_SALE = (" AND (COALESCE(a.cost_cents, a.settlement_cents) IS NULL"
           " OR a.sale_price_cents >= COALESCE(a.cost_cents, a.settlement_cents)) ")
