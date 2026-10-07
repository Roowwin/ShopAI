#!/bin/sh
set -e
echo "==> RFO: roles, grants, extensions"

psql -v ON_ERROR_STOP=1 \
     -v migrator_pwd="$DB_MIGRATOR_PASSWORD" \
     -v app_pwd="$DB_APP_PASSWORD" \
     -v ro_pwd="$DB_READONLY_PASSWORD" \
     --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'EOSQL'
REVOKE ALL ON SCHEMA public FROM PUBLIC;

CREATE ROLE rfo_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'migrator_pwd';
CREATE ROLE rfo_app      LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'app_pwd';
CREATE ROLE rfo_ro       LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'ro_pwd';

GRANT CONNECT ON DATABASE rfo TO rfo_migrator, rfo_app, rfo_ro;
GRANT USAGE, CREATE ON SCHEMA public TO rfo_migrator;
GRANT USAGE ON SCHEMA public TO rfo_app, rfo_ro;

-- everything the migrator creates later is usable by app/ro automatically
ALTER DEFAULT PRIVILEGES FOR ROLE rfo_migrator IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO rfo_app;
ALTER DEFAULT PRIVILEGES FOR ROLE rfo_migrator IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO rfo_app;
ALTER DEFAULT PRIVILEGES FOR ROLE rfo_migrator IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO rfo_app;
ALTER DEFAULT PRIVILEGES FOR ROLE rfo_migrator IN SCHEMA public GRANT SELECT ON TABLES TO rfo_ro;

ALTER ROLE rfo_app SET search_path = public;
ALTER ROLE rfo_app SET statement_timeout = '30s';
ALTER ROLE rfo_app SET idle_in_transaction_session_timeout = '20s';
ALTER ROLE rfo_ro SET statement_timeout = '60s';
ALTER ROLE rfo_ro SET default_transaction_read_only = on;

CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS btree_gin;
EOSQL
echo "==> RFO: roles/grants/extensions done"