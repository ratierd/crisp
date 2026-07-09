FROM oven/bun:1.3-alpine AS build
WORKDIR /repo
COPY package.json bun.lock nx.json tsconfig.base.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY libs/ai/package.json libs/ai/
COPY libs/contracts/package.json libs/contracts/
COPY libs/domain/package.json libs/domain/
RUN bun install --frozen-lockfile
COPY . .
RUN bunx vite build apps/web

FROM oven/bun:1.3-alpine
WORKDIR /repo
COPY --from=build /repo/node_modules node_modules
COPY --from=build /repo/apps/server apps/server
COPY --from=build /repo/libs libs
COPY --from=build /repo/package.json /repo/tsconfig.base.json ./
COPY --from=build /repo/apps/web/dist apps/web/dist
# /data pre-owned by bun: fresh compose named volumes inherit this ownership;
# on Railway the mount is chowned via RAILWAY_RUN_UID=1000 (.railway/railway.ts).
RUN mkdir -p /data && chown bun:bun /data
USER bun
ENV NODE_ENV=production
ENV STATIC_DIR=/repo/apps/web/dist
EXPOSE 3000
CMD ["bun", "run", "apps/server/src/index.ts"]
