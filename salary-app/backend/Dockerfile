# Builds the dashboard, then serves it from the API in one container.
FROM node:20-slim AS frontend
WORKDIR /app
# shared/ is imported by both sides, so it has to be present for the build.
COPY shared ./shared
COPY frontend/package*.json ./frontend/
RUN cd frontend && npm ci
COPY frontend ./frontend
RUN cd frontend && npm run build

FROM node:20-slim
WORKDIR /app/backend

# better-sqlite3 ships prebuilds for this platform; python3/make are only needed
# if it has to fall back to compiling.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY backend/package*.json ./
RUN npm ci --omit=dev

COPY shared /app/shared
COPY backend ./
COPY --from=frontend /app/frontend/dist ./public

ENV NODE_ENV=production
ENV DATA_DIR=/data
EXPOSE 3002

CMD ["node", "src/index.js"]
