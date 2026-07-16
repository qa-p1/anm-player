FROM node:24-alpine AS base
WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps/web/package.json apps/web/package.json

FROM base AS development
RUN npm install
COPY apps/web apps/web
WORKDIR /app/apps/web
EXPOSE 5173

FROM base AS build
ARG VITE_API_BASE_URL
ARG VITE_API_ACCESS_TOKEN
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_API_ACCESS_TOKEN=$VITE_API_ACCESS_TOKEN
RUN npm ci
COPY apps/web apps/web
WORKDIR /app/apps/web
RUN npm run build

FROM nginx:1.29-alpine AS production
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
