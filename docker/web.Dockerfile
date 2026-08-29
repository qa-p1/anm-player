FROM node:24-alpine3.22@sha256:191c9f0080fcbbc6547a85dc0ff7988072214a355aabdc1d2ec55a7dae5eea8a AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
RUN npm ci

FROM dependencies AS development
COPY VERSION ./VERSION
COPY apps/web apps/web
WORKDIR /app/apps/web
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]

FROM dependencies AS build
COPY VERSION ./VERSION
COPY apps/web apps/web
WORKDIR /app/apps/web
RUN npm run build

FROM nginx:1.31.4-alpine@sha256:db35bfc6b2951e7f8a72db5db120288c127ffaeeb4a6d4b95a26fead017d5913 AS production
COPY docker/nginx.conf /etc/nginx/templates/anm-player.conf.template
COPY docker/web-entrypoint.sh /usr/local/bin/anm-player-web-entrypoint
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
RUN chmod 0755 /usr/local/bin/anm-player-web-entrypoint \
    && rm -f /etc/nginx/conf.d/default.conf
EXPOSE 80
ENTRYPOINT ["anm-player-web-entrypoint"]
