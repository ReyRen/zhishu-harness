---
kind: upgrade-guide
description: Harness Web 通过同源网关路径加载知识库面板，移除独立的浏览器地址配置。
---

# 知识库面板的 Web 网关

[English](guide.md) | 中文

## 变更

平台 Web 部署原先单独填写知识库页面地址，或从 API 地址推导。知识库面板现在从 Harness 页面的源打开 `/weknora/sso/platform`。Web 网关必须提供整个 `/weknora/` 前缀。

## 迁移

1. 在提供 Harness 入口的 HTTPS 服务中添加[知识库反向代理](../../../../overlay/weknora/README.zh.md)。确认 `/weknora/api/v1/auth/platform-sso/config` 返回适用于该源的 gcs-webnora SSO 配置。
2. 更新 Harness 镜像。如果已配置独立的浏览器地址，从 Compose 环境中移除 `WEKNORA_WEB_URL`，或从 Worker 配置中移除 `weknoraWebURL`。保留服务端的 API 配置 `WEKNORA_BASE_URL` 或 `weknoraBaseURL`。
3. 登录平台并打开知识库面板。确认 iframe 仍在 Harness 的源上，能够登录并加载当前用户的知识库。
