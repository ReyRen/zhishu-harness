/** Dev server the unpackaged shell loads. */
export const DEVELOPMENT_MODEL_ORIGIN: 'http://127.0.0.1:8888'

/** Page origin baked into a packaged app. Backend addresses stay in model-gateway.json. */
export const PACKAGED_MODEL_ORIGIN: 'http://127.0.0.1:17321'

/**
 * Validate a model site origin.
 * @param raw - Candidate origin.
 * @param label - Error prefix.
 * @returns Origin without a path.
 */
export function parseModelOrigin(raw: string, label: string): string

/**
 * Origin written into the installer. The page is the local gateway.
 * @returns Model site origin.
 */
export function resolvePackagedModelOrigin(): typeof PACKAGED_MODEL_ORIGIN
