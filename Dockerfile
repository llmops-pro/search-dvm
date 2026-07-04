# search-dvm — a long-lived NOSTR DVM worker (no inbound HTTP).
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY dist ./dist
CMD ["node", "dist/index.js"]
