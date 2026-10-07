FROM public.ecr.aws/docker/library/alpine:3.20

RUN apk add --no-cache pgbouncer postgresql16-client

RUN addgroup -S pgbouncer && adduser -S -D -H -h /var/lib/pgbouncer -G pgbouncer -s /sbin/nologin pgbouncer && mkdir -p /etc/pgbouncer /var/lib/pgbouncer && chown -R pgbouncer:pgbouncer /etc/pgbouncer /var/lib/pgbouncer

COPY entrypoint.sh /usr/local/bin/rfo-entrypoint.sh
RUN chmod 0755 /usr/local/bin/rfo-entrypoint.sh

USER pgbouncer
ENTRYPOINT ["/usr/local/bin/rfo-entrypoint.sh"]
