# syntax=docker/dockerfile:1

# --- Build the Angular app ---------------------------------------------------------------
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
# Install scripts are skipped: native Node add-ons (onnxruntime-node, sharp) are never used in the browser build.
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY . .
RUN npm run build

# --- Whisper models, served by the site itself (about 1.5 GB for the three) ------------------
# Its own stage: Docker keeps it in cache, so the models are only downloaded again when the
# list changes. Build argument: WHISPER_MODELS=tiny,base,small (an empty list keeps Hugging Face).
FROM node:24-alpine AS models
ARG WHISPER_MODELS=tiny,base,small
WORKDIR /models-build
COPY scripts/download-models.mjs .
RUN mkdir -p /models && if [ -n "$WHISPER_MODELS" ]; then node download-models.mjs --out /models --models "$WHISPER_MODELS"; fi

# --- Serve the static files ----------------------------------------------------------------
FROM nginx:1.29-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/headers.conf /etc/nginx/snippets/headers.conf
COPY --from=models /models /usr/share/nginx/html/models
COPY --from=build /app/dist/localcutvideo/browser /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz >/dev/null || exit 1
