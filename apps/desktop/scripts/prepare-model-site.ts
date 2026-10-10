/** Build the model page and its micro-apps, then stage them for the desktop installer. */

import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { desktopTargetBuildPaths, resolveDesktopBuildTarget } from './desktop-build-paths.mjs'

const CODE_ROOT = resolve(import.meta.dirname, '../../../..')
const MODEL_ROOT = process.env.DSH_MODEL_ROOT?.trim() || join(CODE_ROOT, 'model')
const FLOW_ROOT = join(CODE_ROOT, 'gcs-infer-center', 'web')
const PROMPT_APP = join(CODE_ROOT, 'gcs-loop', 'frontend', 'apps', 'cozeloop')
const PROMPT_DIST = join(CODE_ROOT, 'gcs-loop', 'frontend', 'dist', 'micro-app-prompt')
const DEFAULT_GATEWAY = fileURLToPath(new URL('../resources/model-gateway.default.json', import.meta.url))

/**
 * Build delivery assets and copy them to the target's model-site directory.
 * `DSH_MODEL_DELIVERY=lite` builds only the host. The default `full` also builds flow and prompt.
 * `DSH_DESKTOP_SKIP_MODEL_BUILD=1` copies dists that are already present.
 */
function main(): void {
  const mode = process.env.DSH_MODEL_DELIVERY?.trim() || 'full'
  if (mode !== 'full' && mode !== 'lite') throw new Error('desktop model site: DSH_MODEL_DELIVERY must be full or lite')
  const skipBuild = process.env.DSH_DESKTOP_SKIP_MODEL_BUILD === '1'
  if (!skipBuild) {
    if (mode === 'full') {
      run('pnpm', ['run', 'build:micro'], FLOW_ROOT)
      run('pnpm', ['exec', 'rushx', 'build'], PROMPT_APP)
    }
    run('npm', ['run', mode === 'lite' ? 'build:delivery:lite' : 'build:delivery:full'], MODEL_ROOT)
  }
  const output = desktopTargetBuildPaths(resolveDesktopBuildTarget()).modelSite
  rmSync(output, { recursive: true, force: true })
  mkdirSync(output, { recursive: true })
  copyDist(join(MODEL_ROOT, 'dist'), join(output, 'app'), 'model dist')
  if (mode === 'full') {
    copyDist(join(FLOW_ROOT, 'dist', 'micro-app-flow'), join(output, 'flow'), 'flow dist')
    copyDist(PROMPT_DIST, join(output, 'prompt'), 'prompt dist')
  }
  cpSync(DEFAULT_GATEWAY, join(output, 'gateway.default.json'))
}

/** @param source - Built directory. @param destination - Staged directory. @param label - Error name. */
function copyDist(source: string, destination: string, label: string): void {
  if (!existsSync(join(source, 'index.html'))) throw new Error(`desktop model site: ${label} is missing at ${source}`)
  cpSync(source, destination, { recursive: true })
}

/** @param command - Executable. @param args - Arguments. @param cwd - Working directory. */
function run(command: string, args: string[], cwd: string): void {
  if (!existsSync(cwd)) throw new Error(`desktop model site: ${cwd} does not exist`)
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32', env: process.env })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`desktop model site: ${command} ${args.join(' ')} exited ${String(result.status)} in ${cwd}`)
  }
}

main()
