/** Private-registry release of the Web-authenticated, offline Workflow package. */
export declare const visualWorkflowVersion: '0.11.1-zhishu.1'

/**
 * Write a complete plugin archive; network access is permitted only by an explicit packaging call.
 * @param tarballsDir - Output directory for the installable package.
 * @param options - Verified model cache and packaging-only download permission.
 * @returns Prepared archive path. Missing or altered resources reject the operation.
 */
export declare function prepareVisualWorkflow(tarballsDir: string, options?: {
  cacheDir?: string
  allowDownload?: boolean
}): Promise<string>
