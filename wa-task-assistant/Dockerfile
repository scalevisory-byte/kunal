# Builds the dashboard, then runs the backend with a system Chromium for whatsapp-web.js.
# Lives at the root of wa-task-assistant/ so Railway finds it with no configured
# path - set the service Root Directory to wa-task-assistant and nothing else.

FROM node:20-bookworm-slim AS frontend
ENV PUPPETEER_SKIP_DOWNLOAD=true
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM node:20-bookworm-slim
ENV NODE_ENV=production \
    PUPPETEER_SKIP_DOWNLOAD=true \
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
RUN npm ci --omit=dev && npm cache clean --force

COPY backend/src ./src
COPY --from=frontend /build/dist ./public

# No VOLUME instruction: Railway rejects it ("docker VOLUME ... is not supported,
# use Railway Volumes") and the platform volume mounted at /data does this job.
RUN mkdir -p /data

EXPOSE 3001
CMD ["node", "src/index.js"]
