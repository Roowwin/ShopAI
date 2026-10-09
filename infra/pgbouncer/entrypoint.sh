#!/bin/sh
set -e
: "${POSTGRES_SUPERUSER:?POSTGRES_SUPERUSER required}"
: "${POSTGRES_SUPERUSER_PASSWORD:?POSTGRES_SUPERUSER_PASSWORD required}"
: "${DB_MIGRATOR_PASSWORD:?DB_MIGRATOR_PASSWORD required}"
: "${DB_APP_PASSWORD:?DB_APP_PASSWORD required}"
: "${DB_READONLY_PASSWORD:?DB_READONLY_PASSWORD required}"
: "${DB_AI_STAFF_PASSWORD:?DB_AI_STAFF_PASSWORD required}"
: "${DB_AI_PUBLIC_PASSWORD:?DB_AI_PUBLIC_PASSWORD required}"

cat > /etc/pgbouncer/userlist.txt <<EOF
"${POSTGRES_SUPERUSER}"      "${POSTGRES_SUPERUSER_PASSWORD}"
"rfo_migrator"  "${DB_MIGRATOR_PASSWORD}"
"rfo_app"       "${DB_APP_PASSWORD}"
"rfo_ro"        "${DB_READONLY_PASSWORD}"
"rfo_ai_staff"  "${DB_AI_STAFF_PASSWORD}"
"rfo_ai_public" "${DB_AI_PUBLIC_PASSWORD}"
EOF
chmod 600 /etc/pgbouncer/userlist.txt

cat > /etc/pgbouncer/pgbouncer.ini <<EOF
[databases]
rfo = host=postgres port=5432 dbname=rfo

[pgbouncer]
listen_addr = 0.0.0.0
listen_port = 5432
auth_type = scram-sha-256
auth_file = /etc/pgbouncer/userlist.txt
admin_users = ${POSTGRES_SUPERUSER}
pool_mode = ${PGBOUNCER_POOL_MODE}
max_client_conn = ${PGBOUNCER_MAX_CLIENT_CONN}
default_pool_size = ${PGBOUNCER_DEFAULT_POOL_SIZE}
max_prepared_statements = 200
server_reset_query = DISCARD ALL
ignore_startup_parameters = extra_float_digits,options,search_path
server_lifetime = 3600
server_idle_timeout = 300
server_connect_timeout = 5
log_connections = 0
log_disconnections = 0
log_pooler_errors = 1
EOF

exec pgbouncer /etc/pgbouncer/pgbouncer.ini
