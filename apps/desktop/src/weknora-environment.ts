/**
 * Host-side WeKnora tool auth (`overlay/weknora`) reads `WEKNORA_BASE_URL`.
 * Containers get it from Worker/compose; Desktop must supply a default or the
 * Host falls back to localhost:8080 and catalog/auth handoff returns 502.
 */

/** Same API origin as docker/.env.example (backend, not the SSO iframe page). */
export const DEFAULT_DESKTOP_WEKNORA_BASE_URL = 'http://172.18.36.230:5175/weknora/api/v1'

/**
 * Ensure the Desktop Host child receives a WeKnora API base URL.
 * An explicit `WEKNORA_BASE_URL` in the process environment wins.
 * @param env - environment inherited by the Host subprocess.
 */
export function withDesktopWeknoraEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const configured = env.WEKNORA_BASE_URL?.trim()
  if (configured) {
    if (env.WEKNORA_BASE_URL === configured) return env
    return { ...env, WEKNORA_BASE_URL: configured }
  }
  return { ...env, WEKNORA_BASE_URL: DEFAULT_DESKTOP_WEKNORA_BASE_URL }
}
