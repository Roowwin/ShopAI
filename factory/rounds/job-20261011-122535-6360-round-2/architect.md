# architect review round 2

VERDICT: PASS
- INNER JOIN fix, sufficiency proven from migration 0006 chk_listed_has_price (listed implies non-null price); regression-proof recorded: test fails against reverted LEFT JOIN.
- New hermetic test: four absence states via real audited PUT + public endpoint; finally restores settings/product/staff; payload-integrity assert (hero still served).
- Scope: store_catalog.py + test file only; commit bf51a47; gate 28 passed / 4 deselected on fresh-baked image.
