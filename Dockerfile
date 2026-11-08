# syntax=docker/dockerfile:1

# --- Build the Angular app ---------------------------------------------------------------
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
# Install scripts are skipped: native Node add-ons (onnxruntime-node, sharp) are never used in the browser build.
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY . .
RUN npm run build

# --- Serve the static files ----------------------------------------------------------------
FROM nginx:1.29-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/headers.conf /etc/nginx/snippets/headers.conf
COPY --from=build /app/dist/localcutvideo/browser /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz >/dev/null || exit 1
