FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

FROM denoland/deno:2.2.0

WORKDIR /app

COPY --from=builder /app/build ./build
COPY --from=builder /app/public ./public
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

ENV PORT=3000

EXPOSE 3000

CMD ["deno", "serve", "--allow-net", "--allow-env", "--allow-read", "--allow-write", "--port", "3000", "build/index.js"]
