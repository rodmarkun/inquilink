FROM node:22-alpine AS build
WORKDIR /app
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/tsconfig.json ./
COPY server/src ./src
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY server/drizzle ./drizzle
EXPOSE 3001
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=5 \
  CMD wget -q --spider http://127.0.0.1:3001/api/v1/ready || exit 1
CMD ["sh", "-c", "node dist/db/migrate.js && if [ \"$SEED_DEMO\" = \"true\" ]; then node dist/db/seed.js; fi && node dist/main.js"]
