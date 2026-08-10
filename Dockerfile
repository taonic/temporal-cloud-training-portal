# Next.js and the Temporal worker share one process, so this is one image.
FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production
# node:22-slim ships no CA bundle. Node's own TLS carries bundled roots, so the
# web side and the gRPC Cloud Ops client are unaffected — but the Temporal SDK's
# native core reads the *system* store and dies with NativeCertsNotFound, which
# looks like a worker bug rather than a missing package.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
# The Cloud Ops client reads this descriptor set at runtime.
COPY proto ./proto
COPY src ./src
COPY package.json next.config.mjs tsconfig.json ./
EXPOSE 3000
CMD ["pnpm", "start"]
