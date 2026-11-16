/** Exact versions whose compiled payload is delivered without installation hooks. */
export declare const workflowRuntimeVersions: Readonly<Record<string, string>>
/**
 * Preserve the runtime manifest while selecting the reviewed, script-free dependency graph.
 * @param original - Manifest from a hash-verified npm archive.
 * @returns Private-release manifest retaining exports, licenses, binaries and optional packages.
 */
export declare function offlineWorkflowManifest(original: Record<string, unknown> & {
  name: string
  version: string
  gypfile?: boolean
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
}): Record<string, unknown>
/**
 * Prepare distinct private versions from integrity-locked npm payloads without running scripts.
 * @param tarballsDir - Verified dependency archives and metadata produced by prepareOfflineDependencies.
 * @returns Number of prepared private runtime packages.
 */
export declare function prepareWorkflowRuntime(tarballsDir: string): Promise<number>
