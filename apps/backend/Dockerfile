FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
# Avoid lockfile strict failures + skip postinstall (prisma) until full source is copied
RUN npm install --ignore-scripts

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Prisma schema exists only after COPY . .
RUN npm run prisma:generate && npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
EXPOSE 8080
CMD ["node","dist/main.js"]
