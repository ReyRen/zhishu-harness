/**
 * Browser-only overlay. The host row exists so the web profile loads this
 * package and picks up its client bundle. The page origin is already serving
 * the brand mark this client paints.
 */
export const inject = ['webServer']

/** @param _ctx - unused; the visible change lives in client.js. */
export function apply(_ctx) {}
