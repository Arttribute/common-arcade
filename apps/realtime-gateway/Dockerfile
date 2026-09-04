FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /workspace
COPY . .
RUN pnpm install --frozen-lockfile --ignore-scripts
RUN pnpm --filter @common-arcade/realtime-gateway... build

FROM node:22-alpine AS runtime
RUN corepack enable
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4100
WORKDIR /workspace
COPY --from=build /workspace /workspace
EXPOSE 4100
USER node
CMD ["node", "apps/realtime-gateway/dist/index.js"]
