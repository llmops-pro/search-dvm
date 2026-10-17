# search-dvm — a long-lived NOSTR DVM worker (no inbound HTTP).
FROM node:22-slim AS deps
WORKDIR /app
# Install exactly what's in the lockfile (an unpinned npm install gave production
# different library versions than the ones tested locally).
COPY package.json pnpm-lock.yaml ./
RUN npx -y pnpm@10 install --prod --frozen-lockfile

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY dist ./dist
CMD ["node", "dist/index.js"]
