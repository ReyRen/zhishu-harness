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
    git \
    make \
    g++ \
    python3 \
  && npm install --global pnpm@11.7.0

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

COPY . ./

RUN --mount=type=cache,id=zhishu-harness-pnpm,target=/pnpm/store \
  pnpm install --offline --frozen-lockfile

RUN test -n "${DSH_CLIENT_COMMIT_HASH}" \
  && DSH_CLIENT_COMMIT_HASH="${DSH_CLIENT_COMMIT_HASH}" pnpm run build

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
ENV NODE_ENV=production
ENV NODE_OPTIONS=--enable-source-maps
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
    bash \
    ca-certificates \
    curl \
    git \
    g++ \
    make \
    openssh-client \
    procps \
    python3 \
    ripgrep \
    socat \
    tini \
  && npm install --global pnpm@11.7.0

COPY --from=builder /opt/dsh /opt/dsh
COPY --chmod=0755 docker/container-entrypoint.sh /opt/dsh/deploy/container-entrypoint.sh

WORKDIR /storage-root-jfs/user

VOLUME ["/storage-root-jfs/user"]
EXPOSE 3081

ENTRYPOINT ["tini", "-g", "--", "/opt/dsh/deploy/container-entrypoint.sh"]
