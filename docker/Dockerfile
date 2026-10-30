# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=24-bookworm-slim
ARG DEBIAN_MIRROR=http://deb.debian.org/debian
ARG DEBIAN_SECURITY_MIRROR=http://deb.debian.org/debian-security

FROM node:${NODE_VERSION} AS build-base

ARG DEBIAN_MIRROR
ARG DEBIAN_SECURITY_MIRROR

ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}

RUN --mount=type=cache,id=zhishu-harness-apt-cache,target=/var/cache/apt,sharing=locked \
  --mount=type=cache,id=zhishu-harness-apt-lists,target=/var/lib/apt,sharing=locked \
  sed -i \
    -e "s|http://deb.debian.org/debian-security|${DEBIAN_SECURITY_MIRROR}|g" \
    -e "s|http://deb.debian.org/debian|${DEBIAN_MIRROR}|g" \
    /etc/apt/sources.list.d/debian.sources \
  && rm -f /etc/apt/apt.conf.d/docker-clean \
  && apt-get update \
  && apt-get install --yes --no-install-recommends \
    ca-certificates \
    curl \
    git \
    make \
    g++ \
    python3 \
  && npm install --global pnpm@11.28.5

WORKDIR /opt/dsh

FROM build-base AS dependencies

COPY package.json ./package.json
COPY pnpm-lock.yaml ./pnpm-lock.yaml
COPY pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY patches ./patches

RUN --mount=type=cache,id=zhishu-harness-pnpm,target=/pnpm/store \
  pnpm fetch --frozen-lockfile

FROM dependencies AS builder

ARG DSH_CLIENT_COMMIT_HASH
ARG TARGETARCH
ARG DSH_RESOURCE_DOWNLOAD_TIMEOUT_MS=600000

COPY . ./

# COPY can retain empty retired-package directories after ignoring their old lib outputs.
# Use the official repository cleaner before compiling this fresh image workspace.
RUN --mount=type=cache,id=zhishu-harness-pnpm,target=/pnpm/store \
  pnpm install --offline --frozen-lockfile \
  && pnpm run clean

RUN for script in docker/*.mjs; do node --check "$script"; done \
  && node --test docker/tests/*.test.mjs

RUN test -n "${DSH_CLIENT_COMMIT_HASH}" \
  && DSH_CLIENT_COMMIT_HASH="${DSH_CLIENT_COMMIT_HASH}" pnpm run build

RUN node --import tsx/esm docker/prepare-market.mjs /opt/dsh-market

RUN --mount=type=cache,id=zhishu-harness-primary-runtime,target=/var/cache/dsh-primary-runtime,sharing=locked \
  case "${TARGETARCH}" in \
    amd64) runtime_target=linux-x64 ;; \
    arm64) runtime_target=linux-arm64 ;; \
    *) echo "Unsupported primary runtime architecture: ${TARGETARCH}" >&2; exit 1 ;; \
  esac \
  && DSH_RESOURCE_DOWNLOAD_TIMEOUT_MS="${DSH_RESOURCE_DOWNLOAD_TIMEOUT_MS}" node docker/cache-primary-runtime.mjs \
    "${runtime_target}" /var/cache/dsh-primary-runtime \
  && CI=true DSH_RESOURCE_DOWNLOAD_TIMEOUT_MS="${DSH_RESOURCE_DOWNLOAD_TIMEOUT_MS}" pnpm run prepare:primary-runtime \
    --target "${runtime_target}" \
    --output /opt/dsh-runtime \
    --cache /var/cache/dsh-primary-runtime

FROM build-base AS market-dependencies

WORKDIR /opt/dsh/market-registry
COPY market-registry/package.json market-registry/pnpm-lock.yaml ./
RUN --mount=type=cache,id=zhishu-harness-market-pnpm,target=/pnpm/store \
  pnpm install --ignore-workspace --prod --frozen-lockfile --config.auto-install-peers=false

FROM node:${NODE_VERSION} AS runtime

ARG DEBIAN_MIRROR
ARG DEBIAN_SECURITY_MIRROR

ENV DEBIAN_FRONTEND=noninteractive
ENV DSH_HOME=/storage-root-jfs/user/dsh-home
ENV DSH_WORKSPACE_ROOT=/storage-root-jfs/user
ENV DSH_DEFAULT_WORKSPACE=/storage-root-jfs/user/workspace
ENV DSH_DEFAULT_WORKSPACE_TITLE=默认工作区
ENV DSH_WEB_PORT=3080
ENV DSH_INTERNAL_PORT=3081
ENV DSH_PRIMARY_RUNTIME=/opt/dsh-runtime/primary-runtime
ENV DSHM_REGISTRY_URL=http://127.0.0.1:4874/plugins.json
ENV DSHM_NPM_MIRROR=http://127.0.0.1:4873
ENV npm_config_auto_install_peers=false
ENV pnpm_config_auto_install_peers=false
ENV PYTHONDONTWRITEBYTECODE=1
ENV NODE_ENV=production
ENV NODE_OPTIONS=--enable-source-maps
ENV PNPM_HOME=/pnpm
ENV PATH=${DSH_PRIMARY_RUNTIME}/dependencies/python/bin:${PNPM_HOME}:${PATH}

RUN --mount=type=cache,id=zhishu-harness-apt-cache,target=/var/cache/apt,sharing=locked \
  --mount=type=cache,id=zhishu-harness-apt-lists,target=/var/lib/apt,sharing=locked \
  sed -i \
    -e "s|http://deb.debian.org/debian-security|${DEBIAN_SECURITY_MIRROR}|g" \
    -e "s|http://deb.debian.org/debian|${DEBIAN_MIRROR}|g" \
    /etc/apt/sources.list.d/debian.sources \
  && rm -f /etc/apt/apt.conf.d/docker-clean \
  && apt-get update \
  && apt-get install --yes --no-install-recommends \
    bash \
    bubblewrap \
    ca-certificates \
    curl \
    fontconfig \
    fonts-dejavu-core \
    fonts-liberation2 \
    fonts-noto-cjk \
    git \
    g++ \
    make \
    openssh-client \
    procps \
    python3 \
    ripgrep \
    socat \
    tini \
  && npm install --global pnpm@11.28.5

COPY --from=builder /opt/dsh /opt/dsh
COPY --from=builder /opt/dsh-runtime /opt/dsh-runtime
COPY --from=builder /opt/dsh-market /opt/dsh-market
COPY --from=market-dependencies /opt/dsh/market-registry/node_modules /opt/dsh/market-registry/node_modules
COPY --chmod=0755 docker/container-entrypoint.sh /opt/dsh/deploy/container-entrypoint.sh
COPY --chmod=0755 docker/bwrap /usr/local/bin/bwrap

# Plugin-manager metadata probes use pnpm's own registry configuration too.
# Keep them on the bundled private source rather than waiting on public npm.
ENV npm_config_registry=http://127.0.0.1:4873
ENV pnpm_config_registry=http://127.0.0.1:4873

FROM runtime AS validated

RUN --network=none node /opt/dsh/docker/smoke-office.mjs \
  && node /opt/dsh/docker/smoke-market.mjs \
  && node /opt/dsh/docker/smoke-memory.mjs

ARG DSH_CLIENT_COMMIT_HASH

LABEL org.opencontainers.image.source="https://github.com/ReyRen/zhishu-harness" \
  org.opencontainers.image.revision="${DSH_CLIENT_COMMIT_HASH}"

WORKDIR /storage-root-jfs/user

VOLUME ["/storage-root-jfs/user"]
EXPOSE 3081

ENTRYPOINT ["tini", "-g", "--", "/opt/dsh/deploy/container-entrypoint.sh"]
