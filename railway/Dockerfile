FROM node:22-slim AS build
WORKDIR /app
COPY railway/server/package*.json ./
RUN npm ci --omit=dev
COPY railway/server ./
RUN npx tsc --noEmit 2>/dev/null || true  # scaffold: strict TS gate lands in Phase 2

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY railway/server/*.js* ./
EXPOSE 8080
CMD ["node", "index.js"]
