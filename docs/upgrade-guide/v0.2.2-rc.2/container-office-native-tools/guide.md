---
kind: upgrade-guide
description: Container Office operations use the packaged Office skills and native tools instead of image-specific CLI skills.
---

# Container Office operation tools

English | [中文](guide.zh.md)

## Change

Container Web profiles use the shipped `office`, `office-docx`, `office-pptx` and `office-xlsx` skills with native `office_render`, `office_convert` and `office_recalculate` tools. The image-specific `office-render`, `office-recalculate` and `office-export-pdf` skills and their injected CLI-path JSON are removed. The bundled Python, Node.js and pnpm runtime remains available in place through `load_workspace_dependencies`.

## Migration

1. Deploy the Host, Client, packaged skills and Office Kit from the same image. Keep `DSH_PRIMARY_RUNTIME` pointed at the image payload. Use the image's `docker/office.cordis.patch.yml`; do not carry a stale `skill-office` `node` setting or an external `office-skills` path.
2. Update workflows that name the removed skills to load `office` or the relevant document skill, then invoke the native operation tool. Copy retained conversion results to the destination Workspace as needed.
3. Run `node /opt/dsh/docker/smoke-office.mjs` in an isolated container without user mounts. Confirm DOCX, PPTX and XLSX PDF conversion, spreadsheet recalculation and PNG rendering, and that the primary runtime was not copied into the temporary Harness home.
