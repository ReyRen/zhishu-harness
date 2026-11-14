/** Packaging inputs for the locked offline npm dependency set. */
export interface OfflineDependencyOptions {
  lockPath: string
  tarballsDir: string
  /** Cache directory; omitted caches directly in tarballsDir. */
  cacheDir?: string
  /** Fetch implementation; omitted uses the runtime's fetch. */
  fetchImpl?: typeof fetch
}

/**
 * Download and verify locked packages while preserving original npm policy metadata.
 * @param options - Locked inputs and packaging-owned output/cache directories.
 * @returns Number of prepared package versions.
 */
export function prepareOfflineDependencies(options: OfflineDependencyOptions): Promise<number>
