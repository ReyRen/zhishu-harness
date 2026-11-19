---
kind: upgrade-guide
description: Harness Web loads the knowledge panel through a same-origin gateway route and retires its separate browser URL setting.
---

# Knowledge panel Web gateway

English | [中文](guide.zh.md)

## Change

Platform Web deployments previously supplied a knowledge page URL or derived it from their API address. The knowledge panel now opens `/weknora/sso/platform` on the Harness page's origin. The Web gateway must serve the entire `/weknora/` prefix.

## Migration

1. Add the [knowledge reverse proxy](../../../../overlay/weknora/README.md) to the HTTPS server block that serves Harness. Verify that `/weknora/api/v1/auth/platform-sso/config` returns gcs-webnora's SSO configuration for that origin.
2. Update the Harness image. Remove `WEKNORA_WEB_URL` from the Compose environment or `weknoraWebURL` from the Worker configuration if present. Retain the server-side API setting as `WEKNORA_BASE_URL` or `weknoraBaseURL`.
3. Open the knowledge panel from an authenticated platform session. Confirm that the frame stays on the Harness origin, signs in and loads the current user's knowledge bases.
