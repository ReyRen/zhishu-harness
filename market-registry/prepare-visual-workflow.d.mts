/** Private-registry release of the Web-authenticated, offline Workflow package. */
export declare const visualWorkflowVersion: '1.1.1-zhishu.1'

/**
 * Write the current plugin archive and its byte-identical predecessor for installed profile lockfiles.
 * @param tarballsDir - Output directory for the installable package.
 * @param options - Verified model cache and packaging-only download permission.
 * @returns Prepared archive path. Missing or altered resources reject the operation.
 */
export declare function prepareVisualWorkflow(tarballsDir: string, options?: {
  cacheDir?: string
  allowDownload?: boolean
}): Promise<string>
