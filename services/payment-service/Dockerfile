FROM node:22-bookworm-slim AS build
RUN corepack enable && corepack prepare pnpm@9.15.3 --activate
WORKDIR /app
COPY . .
RUN pnpm --filter @common-arcade/payment-service... install --frozen-lockfile --ignore-scripts
RUN pnpm --filter @common-arcade/payment-service... build
RUN pnpm --filter @common-arcade/payment-service deploy --prod /runtime

FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=4021 ARCADE_PAYMENT_DATA_DIR=/data
WORKDIR /app
COPY --from=build --chown=node:node /runtime .
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 4021
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:4021/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
