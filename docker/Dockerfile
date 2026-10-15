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

RUN node --test docker/tests/cache-primary-runtime.test.mjs

RUN test -n "${DSH_CLIENT_COMMIT_HASH}" \
  && DSH_CLIENT_COMMIT_HASH="${DSH_CLIENT_COMMIT_HASH}" pnpm run build

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
COPY --chmod=0755 docker/container-entrypoint.sh /opt/dsh/deploy/container-entrypoint.sh

RUN --network=none node /opt/dsh/docker/smoke-office.mjs

WORKDIR /storage-root-jfs/user

VOLUME ["/storage-root-jfs/user"]
EXPOSE 3081

ENTRYPOINT ["tini", "-g", "--", "/opt/dsh/deploy/container-entrypoint.sh"]
