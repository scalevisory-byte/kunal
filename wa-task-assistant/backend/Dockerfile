# Builds the dashboard, then runs the backend with a system Chromium for whatsapp-web.js.
# Build context is the wa-task-assistant/ directory (see railway.json).

FROM node:20-bookworm-slim AS frontend
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install
COPY frontend/ ./
RUN npm run build

FROM node:20-bookworm-slim
ENV NODE_ENV=production \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    DATA_DIR=/data

# Chromium plus the fonts and libs whatsapp-web.js needs to render WhatsApp Web.
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      ca-certificates \
      fonts-liberation \
      fonts-noto-color-emoji \
      libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 \
      libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 \
      libpango-1.0-0 libcairo2 \
      python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY backend/package.json backend/package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force

COPY backend/src ./src
COPY --from=frontend /build/dist ./public

RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 3001
CMD ["node", "src/index.js"]
