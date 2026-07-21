# Build context: repository root
# DigitalOcean App Platform: Web Service → Dockerfile path = apps/api/Dockerfile

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY libs/shared/package.json libs/shared/
COPY apps/api/package.json apps/api/
RUN npm ci --workspace=@status/shared --workspace=@status/api

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY tsconfig.base.json ./
COPY libs/shared libs/shared
COPY apps/api apps/api
RUN npm run build -w @status/shared \
  && npm run db:generate -w @status/api \
  && npm run build -w @status/api

# Cross-compile probe agent binaries for remote install
FROM golang:1.22-alpine AS agentbuild
WORKDIR /src
COPY apps/agent/go.mod apps/agent/main.go apps/agent/install.sh apps/agent/status-agent.service ./
RUN mkdir -p /out \
  && CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o /out/status-agent-linux-amd64 . \
  && CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -ldflags="-s -w" -o /out/status-agent-linux-arm64 . \
  && CGO_ENABLED=0 GOOS=darwin GOARCH=amd64 go build -ldflags="-s -w" -o /out/status-agent-darwin-amd64 . \
  && CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go build -ldflags="-s -w" -o /out/status-agent-darwin-arm64 . \
  && cp install.sh status-agent.service /out/

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/libs/shared ./libs/shared
COPY --from=build /app/apps/api ./apps/api
COPY --from=build /app/package.json ./
COPY --from=agentbuild /out/ /app/apps/api/public/agent/
WORKDIR /app/apps/api
EXPOSE 3000
CMD ["sh", "-c", "npx prisma db push && npx tsx prisma/seed.ts && node dist/index.js"]
