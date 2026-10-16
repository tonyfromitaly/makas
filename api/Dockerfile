FROM node:22-alpine AS base
WORKDIR /repo
COPY package.json package-lock.json ./
COPY core/package.json core/
COPY api/package.json api/
COPY app/package.json app/
RUN npm ci --workspace api --omit=dev
COPY core core
COPY api api
ENV NODE_ENV=production
USER node
WORKDIR /repo/api
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/health || exit 1
CMD ["npx", "tsx", "src/main.ts"]
