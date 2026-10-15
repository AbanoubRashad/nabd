# Builds one Node service (api, ingest or simulator) from the monorepo.
FROM node:24-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS build
ARG APP
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=@nabd/${APP}...
RUN pnpm deploy --filter=@nabd/${APP} --prod /out

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out .
USER node
CMD ["node", "dist/main.js"]
