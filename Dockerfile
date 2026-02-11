FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/ packages/
COPY src/ src/
COPY extensions/ extensions/
COPY skills/ skills/
RUN corepack enable && pnpm install --frozen-lockfile && pnpm build

FROM node:22-alpine
WORKDIR /app
RUN addgroup -g 1001 alfred && adduser -D -u 1001 -G alfred alfred
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/alfred.mjs ./
USER alfred
EXPOSE 18789
HEALTHCHECK --interval=30s --timeout=5s CMD wget -q --spider http://127.0.0.1:18789/health || exit 1
CMD ["node", "alfred.mjs", "gateway"]
