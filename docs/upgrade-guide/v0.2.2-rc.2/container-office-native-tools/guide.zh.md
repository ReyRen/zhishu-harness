---
kind: upgrade-guide
description: 容器 Office 操作使用随包技能和原生工具，替代镜像专有的 CLI 技能。
---

# 容器 Office 操作工具

[English](guide.md) | 中文

## 变更

容器 Web profile 使用随包的 `office`、`office-docx`、`office-pptx` 和 `office-xlsx` skills，配合原生 `office_render`、`office_convert` 和 `office_recalculate` 工具。镜像专有的 `office-render`、`office-recalculate`、`office-export-pdf` skills 及其注入的 CLI 路径 JSON 移除。随包 Python、Node.js 和 pnpm 运行时仍可通过 `load_workspace_dependencies` 原地使用。

## 迁移

1. 使用同一镜像部署 Host、Client、随包技能和 Office Kit。保持 `DSH_PRIMARY_RUNTIME` 指向镜像内载荷，使用镜像的 `docker/office.cordis.patch.yml`，不要沿用过期的 `skill-office` `node` 配置或外部 `office-skills` 路径。
2. 将引用已移除技能的工作流改为加载 `office` 或对应文档技能，再调用原生操作工具。需要长期保留的转换结果须复制到目标工作区。
3. 在不挂载用户目录的隔离容器中运行 `node /opt/dsh/docker/smoke-office.mjs`，确认 DOCX、PPTX、XLSX 的 PDF 转换、表格重算和 PNG 渲染均成功，且临时 Harness home 中未复制 primary runtime。
