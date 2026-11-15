/** Private-registry version of the reviewed Web compatibility patch. */
export declare const mindWorkbenchVersion: '1.0.16-zhishu.1'

/**
 * Prepare a reproducible archive beside the original upstream package.
 * @param tarballsDir - directory containing the upstream archive and receiving the patched archive.
 * @returns the prepared archive path.
 */
export declare function prepareMindWorkbench(tarballsDir: string): Promise<string>
