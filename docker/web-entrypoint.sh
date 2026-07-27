#!/bin/sh
set -eu

if [ -z "${API_ACCESS_TOKEN:-}" ]; then
  echo "API_ACCESS_TOKEN is required for the production web proxy." >&2
  exit 1
fi

# Substitute only the application token. Nginx variables such as $uri,
# $host, and $http_upgrade must remain intact.
envsubst '${API_ACCESS_TOKEN}' \
  < /etc/nginx/templates/aura.conf.template \
  > /etc/nginx/conf.d/default.conf

exec nginx -g 'daemon off;'
