FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
RUN npm install --workspace=@status/shared --workspace=@status/api --workspace=@status/worker

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY packages/shared packages/shared
COPY apps/api/prisma apps/api/prisma
COPY apps/api/package.json apps/api/
COPY apps/worker apps/worker
COPY tsconfig.base.json ./
RUN npm run build -w @status/shared \
  && npx prisma generate --schema=apps/api/prisma/schema.prisma \
  && npm run build -w @status/worker

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/apps/worker ./apps/worker
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
COPY --from=build /app/package.json ./
WORKDIR /app/apps/worker
CMD ["node", "dist/index.js"]
