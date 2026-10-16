#!/bin/sh
# THE TEST DATABASE, AND THE AI WALL.
#
# Two things live here that 01-roles.sh does not do, and neither of them could be done there:
#
# 1. `rfo_test` - the database the pytest suites run in. Until now every run wrote into `rfo`, the
#    database the backoffice and the shop read, and every run left wreckage behind: the teardown
#    cannot delete the `stock_movements` rows its own tests create (the app role holds SELECT+INSERT
#    there and nothing else), and that FK pins the asset, which pins its product, which pins the
#    brand. So the catalogue accumulated immortal `mission-*` / `pytest*` rows that no run would
#    ever remove. With the suites in their own database none of that can reach the shop again.
#
# 2. THE AI WALL - the read-only roles `rfo_ai_staff` / `rfo_ai_public`, the schemas `ai` /
#    `ai_public`, three views and the policy table. This was built BY HAND on the running cluster:
#    no migration and no init script created any of it, so a rebuilt database was missing the wall
#    and `tests/test_ai_wall.py` (which is NOT in the gate's deselect list) failed against it.
#    Recovered from the live cluster with pg_dump on 2026-10-16 and written down here, which is what
#    makes a fresh database reproducible at all.
#
# THE PER-DATABASE HALF IS DELIBERATELY REPEATED from 01-roles.sh for the test database: at this
# point in the entrypoint's order 01 has already run, against POSTGRES_DB only, and there is no way
# to ask it to run again for a database that did not exist when it did. If you change the grants or
# the extensions there, change them here too - and the gate will tell you, because a missing grant
# on rfo_test fails the first INSERT rather than sitting there looking healthy.
#
# IDEMPOTENT, and re-runnable against a cluster that is already up. On a cluster that predates this
# file the script is not inside the running container yet, so feed it in over stdin - which works
# whether or not the container has been recreated since:
#     docker compose exec -T postgres sh -s < infra/postgres/init/02-databases.sh
# The full runbook (this, then the migration, then this again) is in docs/PROJECT_CONTEXT.md.
set -e
echo "==> RFO: test database + AI wall"

TEST_DB="${RFO_TEST_DB:-rfo_test}"

# ---------------------------------------------------------------- the database, and its roles
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
     -v test_db="$TEST_DB" -v main_db="$POSTGRES_DB" \
     -v ai_staff="$DB_AI_STAFF_PASSWORD" -v ai_public="$DB_AI_PUBLIC_PASSWORD" <<'EOSQL'
-- CREATE DATABASE cannot be run twice and has no IF NOT EXISTS, so the statement is BUILT and only
-- then run: `\gexec` executes whatever the query returns, and the query returns nothing when the
-- database is already there.
SELECT format('CREATE DATABASE %I', :'test_db')
 WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'test_db')
\gexec

-- The two AI roles are cluster-wide, so this runs once for the whole cluster. The passwords are the
-- pair .env already carries for them - a role created with a different password is a role pgbouncer
-- cannot log in as, and the AI doors would 500 rather than fail to start.
SELECT format('CREATE ROLE rfo_ai_staff LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD %L',
              :'ai_staff')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rfo_ai_staff')
\gexec
-- 20 connections for the public one: it is reachable without a login, so its whole defence is that
-- it can be exhausted without taking the rest of the platform with it. test_ai_wall.py asserts this
-- number; the connection limit IS the design, not a tuning knob.
SELECT format('CREATE ROLE rfo_ai_public LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE'
              ' CONNECTION LIMIT 20 PASSWORD %L', :'ai_public')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rfo_ai_public')
\gexec

-- THE WALL IS THE ROLE'S OWN SETTINGS as much as it is the views: read-only, and a short clock, so
-- that a prompt-injected query can neither write nor hold a connection open. Nothing in the test
-- suite asserts these two lines, which is exactly why they are written down here instead of being
-- left to whoever set them by hand.
ALTER ROLE rfo_ai_staff SET default_transaction_read_only = on;
ALTER ROLE rfo_ai_staff SET statement_timeout = '5s';
ALTER ROLE rfo_ai_public SET default_transaction_read_only = on;
ALTER ROLE rfo_ai_public SET statement_timeout = '2s';

-- CONNECT is per-database, on both of them: the wall lives in each database separately.
SELECT format('GRANT CONNECT ON DATABASE %I TO rfo_ai_staff, rfo_ai_public', :'main_db')
\gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO rfo_ai_staff, rfo_ai_public', :'test_db')
\gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO rfo_migrator, rfo_app, rfo_ro', :'test_db')
\gexec
EOSQL

# ---------------------------------------------------------------- the test database's own half
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$TEST_DB" <<'EOSQL'
REVOKE ALL ON SCHEMA public FROM PUBLIC;

GRANT USAGE, CREATE ON SCHEMA public TO rfo_migrator;
GRANT USAGE ON SCHEMA public TO rfo_app, rfo_ro;

-- everything the migrator creates later is usable by app/ro automatically - WITHOUT this the
-- alembic chain succeeds and the suite dies on its first INSERT, which reads as a test bug
ALTER DEFAULT PRIVILEGES FOR ROLE rfo_migrator IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO rfo_app;
ALTER DEFAULT PRIVILEGES FOR ROLE rfo_migrator IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO rfo_app;
ALTER DEFAULT PRIVILEGES FOR ROLE rfo_migrator IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO rfo_app;
ALTER DEFAULT PRIVILEGES FOR ROLE rfo_migrator IN SCHEMA public GRANT SELECT ON TABLES TO rfo_ro;

-- citext is a hard migration dependency (0001_initial makes email and serial_number citext); the
-- rest are the same six 01-roles.sh installs, and extensions are database-scoped, so they are
-- missing in a database that was not bootstrapped by it.
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS btree_gin;
EOSQL

# ---------------------------------------------------------------- the wall, in both databases
#
# CREATE OR REPLACE for the views and a DO NOTHING policy upsert, so that running this against a live
# cluster changes nothing: an operator who edited a policy's wording in the database keeps their
# wording, and the recovered text only ever lands in a database that has none.
wall() {
  # THE WALL'S VIEWS READ THE TRADING TABLES, so it can only be built in a database that has been
  # migrated - and on a fresh cluster this script runs during init, before any migration has run
  # anywhere. A database with no `public.products` therefore gets skipped with the instruction
  # rather than an error, and the runbook applies the wall by running this script a second time
  # after `alembic upgrade head`. Running it twice is free: everything below is idempotent.
  if [ "$(psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$1" -tAc \
        "SELECT to_regclass('public.products') IS NOT NULL")" != "t" ]; then
    echo "    $1 has no schema yet - run 'alembic upgrade head' against it, then run this script again"
    return 0
  fi
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$1" <<'EOSQL'
CREATE SCHEMA IF NOT EXISTS ai;
CREATE SCHEMA IF NOT EXISTS ai_public;

CREATE OR REPLACE VIEW ai.catalog AS
 SELECT p.title, p.model, b.name AS brand, c.name AS category,
        COALESCE(sum(CASE WHEN a.status = 'listed' AND l.status = 'active' THEN 1 END), 0) AS available_units,
        min(a.sale_price_cents) AS price_from_cents
   FROM public.products p
   JOIN public.brands b ON b.id = p.brand_id
   JOIN public.categories c ON c.id = p.category_id
   LEFT JOIN public.assets a ON a.product_id = p.id
   LEFT JOIN public.lots l ON l.id = a.lot_id
  GROUP BY p.title, p.model, b.name, c.name;

CREATE OR REPLACE VIEW ai.lots AS
 SELECT l.lot_number, l.status, count(a.id) AS units
   FROM public.lots l
   LEFT JOIN public.assets a ON a.lot_id = l.id
  GROUP BY l.id, l.lot_number, l.status;

CREATE OR REPLACE VIEW ai.promotions AS
 SELECT name, kind, value, active FROM public.promotions;

-- The staff wall reads the trading tables through `ai`; the public wall gets a narrower view that
-- never exposes a lot or a serial, plus the policy answers the public assistant is allowed to give.
CREATE TABLE IF NOT EXISTS ai_public.policies (topic text NOT NULL PRIMARY KEY, body text);

INSERT INTO ai_public.policies (topic, body) VALUES
  ('returns',  'Refurbished units carry change-of-mind and fault returns per Australian Consumer Law.'),
  ('shipping', 'We ship Australia and New Zealand wide; rates shown at checkout.'),
  ('warranty', 'Each unit ships with a stated warranty period according to its grade.')
ON CONFLICT (topic) DO NOTHING;

CREATE OR REPLACE VIEW ai_public.v_available AS
 SELECT p.slug, p.title, p.model, b.name AS brand, a.grade,
        min(a.sale_price_cents) AS price_from_cents, count(*) AS units_available
   FROM public.assets a
   JOIN public.products p ON p.id = a.product_id
   JOIN public.brands b ON b.id = p.brand_id
   JOIN public.lots l ON l.id = a.lot_id
  WHERE a.status = 'listed' AND l.status = 'active'
  GROUP BY p.slug, p.title, p.model, b.name, a.grade;

GRANT USAGE ON SCHEMA ai TO rfo_ai_staff;
GRANT USAGE ON SCHEMA ai_public TO rfo_ai_public;
GRANT SELECT ON TABLE ai.catalog TO rfo_ai_staff;
GRANT SELECT ON TABLE ai.lots TO rfo_ai_staff;
GRANT SELECT ON TABLE ai.promotions TO rfo_ai_staff;
GRANT SELECT ON TABLE ai_public.policies TO rfo_ai_public;
GRANT SELECT ON TABLE ai_public.v_available TO rfo_ai_public;
ALTER DEFAULT PRIVILEGES FOR ROLE rfo_admin IN SCHEMA ai_public GRANT SELECT ON TABLES TO rfo_ai_public;
EOSQL
}

wall "$POSTGRES_DB"
wall "$TEST_DB"

echo "==> RFO: rfo_test and the AI wall done - run 'alembic upgrade head' against $TEST_DB before pytest"
