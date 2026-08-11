# Coffinat — a static site served by Caddy. Pinned base (not :latest) for reproducibility.
# Podman-friendly (also builds with Docker). Only the site files are copied in.
FROM docker.io/library/caddy:2.10-alpine

# The stock caddy binary carries a cap_net_bind_service file capability (to bind :80). We serve on
# a high port (:8080), so it is unnecessary — and its presence makes `no-new-privileges` refuse to
# exec the binary ("Operation not permitted"). Strip it so the hardened compose settings can run.
RUN apk add --no-cache libcap \
 && setcap -r /usr/bin/caddy \
 && apk del libcap

COPY Caddyfile /etc/caddy/Caddyfile
COPY index.html styles.css model.js favicon.svg /srv/
COPY js/ /srv/js/
COPY vendor/ /srv/vendor/

EXPOSE 8080
