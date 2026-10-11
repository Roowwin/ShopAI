# catalog v2: ~50 products across new categories; seed migration + seeder expansion + auto-icons

## Context
Storefront reads live categories/brands; 0002 seeded only phones/laptops/tablets + apple/samsung. The products endpoint requires existing brand/category slugs (422 otherwise). Job 4's seeder carries a static 9-item CATALOG with the RX-SEED-/SEED-DEMO-/seed-demo- idempotency scheme and unit pricing from GRADE_FACTOR.

## Deliverable
1. Migration 0012_catalog_v2 (additive-only; verbatim downgrade = DELETE the new rows it inserted): new categories (slug set: accessories, desktops, networking, parts, monitors, processors) and new brands (realistic set for them: lenovo, dell, hp, asus, logitech, cisco, tp-link, intel, amd, kingston, seagate ON CONFLICT DO NOTHING). No column changes anywhere.
2. scripts/seed_demo.py: CATALOG grows to ~50 products spread: laptops 10 (ThinkPad/Dell Latitude/MacBooks/Ars etc.), desktops 6 (OptiPlex/EliteDesk/Mac mini), monitors 6 (Dell UltraSharp/HP/LG), networking 6 (Cisco small-biz/TP-Link/Netgear), accessories 10 (keyboards/mice/docks/webcams/headsets/hubs), parts 6 (SSDs/RAM kits/laptop batteries), processors 6 (Intel/AMD mainstream). Real model names, AUD price bands per kind (accessories 19-199, parts 29-399, monitors 99-599, CPUs 59-499, desktops 399-999, networking 49-1500, laptops 299-1299), realistic specs dicts, descriptions matching house copy style.
3. Icons: a generic SVG glyph per device-kind set written to apps/storefront/public/icons/ (device classes needed beyond phone/tablet: laptop (exists), desktop tower, monitor, network switch/router box, USB dongle/cable, headset, webcam, chip/CPU, keyboard, mouse, SSD/RAM stick, dock); one file per product (initials + label, same 800x600 template); the seeder PATCHES /staff/cms/products/<id> with image_url=/icons/<slug>.svg right after creating each product (idempotent: skip when unchanged).
4. Tests: hermetic - delta-catalog counts for 2-3 NEW products, one per a never-seeded category; icon-URL presence in the CMS products GET after seeding; existing tests untouched.

## Acceptance
- Migration verified (apply/down/up + EXPLAIN unnecessary); the seeder run post-merge creates ~40 new products + lots + 3-5 units each (cheap: accessories 2-3 units, others 2), patches image_url, and a RE-run skips everything (idempotent).
- Gate: report exact count; 3 deselects unchanged. Storefront: the full catalog renders across all category chips; nav slice may truncate visually (leave the existing slice; note it in the report).
- Allowed surfaces: alembic/versions/0012*, apps/backend/scripts/seed_demo.py, apps/storefront/public/icons/**, tests. Anything else = CHANGES.

## Constraints
- Work only on branch factory/<job-id>; LF/no-BOM; gates AFTER docker compose build api; do not touch .env, secrets/, infra/nginx/certs/, factory/*, existing migrations.