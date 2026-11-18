/** Private-registry release of the Web-authenticated, offline Workflow package. */
export declare const visualWorkflowVersion: '1.4.0-zhishu.1'

/**
 * Write the current plugin archive and retain byte-identical releases referenced by installed profile lockfiles.
 * @param tarballsDir - Output directory for the installable package.
 * @param options - Verified model cache and packaging-only download permission.
 * @returns Prepared archive path. Missing or altered resources reject the operation.
 */
export declare function prepareVisualWorkflow(tarballsDir: string, options?: {
  cacheDir?: string
  allowDownload?: boolean
}): Promise<string>
