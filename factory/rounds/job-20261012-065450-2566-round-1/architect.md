# architect review round 1

Manual reviewer. commit a5686b9; gate 117 passed / 3 deselected (+7); tsc clean; storefront build 13/13; / now request-rendered.

VERDICT: PASS
- Opt-in envelope: default catalog response stays a bare array (pinned byte-identical on _catalog_sql); richer applied/brands envelope only with with_filters=1 (backoffice listings caller preserved).
- URL state: parseFilters normalization (unknown values dropped), router.push with scroll:false (back button = filter history), same URL byte-identical (tested), honest empty state + clear-filters.
- Grade/price narrow the listed-unit join: the 'from' price reflects the filtered grade (correct serialized-inventory semantics, noted in the docs).
- Base-test: test_catalog_from_seed_stock fixed (pagination drift at 57 products; widened window, same assertions) - diagnosed first.
