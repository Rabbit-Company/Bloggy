FROM oven/bun:1 AS build

WORKDIR /build

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY tsconfig.json bunfig.toml ./
COPY src ./src
COPY scripts ./scripts

RUN bun run build

# The runtime image carries
FROM debian:bookworm-slim AS runtime

RUN apt-get update \
	&& apt-get install -y --no-install-recommends ca-certificates curl \
	&& rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=build /build/dist/bloggy ./bloggy
COPY --from=build /build/public ./public

RUN mkdir -p /app/data

ENV PORT=3000 \
	BIND_ADDRESS=0.0.0.0 \
	DATABASE_URL=sqlite://./data/bloggy.sqlite \
	STORAGE_PATH=./data/media \
	PANEL_DIR=./public/panel

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
	CMD curl -fsS "http://127.0.0.1:${PORT}/health" || exit 1

ENTRYPOINT ["./bloggy"]
