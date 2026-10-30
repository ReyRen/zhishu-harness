/** Stage Verdaccio, the catalog, and its tarballs for the desktop installer. */

import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { desktopTargetBuildPaths, resolveDesktopBuildTarget } from './desktop-build-paths.mjs'

const APP_ROOT = resolve(import.meta.dirname, '..')
const SOURCE = resolve(APP_ROOT, '..', '..', 'market-registry')
const MODULE_CACHE = join(APP_ROOT, '.desktop-build', 'downloads', 'market-registry-modules')

/**
 * Install a real (non-linked) Verdaccio tree once, then copy the catalog payload
 * into the current target's resource directory.
 */
function main(): void {
  const manifest = join(SOURCE, 'package.json')
  const catalog = join(SOURCE, 'plugins.json')
  const workbenches = join(SOURCE, 'workbenches.json')
  const tarballs = join(SOURCE, 'tarballs')
  for (const path of [manifest, catalog, workbenches, tarballs]) {
    if (!existsSync(path)) throw new Error(`desktop plugin market: missing ${path}`)
  }
  const modules = ensureModules(manifest)
  const output = desktopTargetBuildPaths(resolveDesktopBuildTarget()).marketRegistry
  rmSync(output, { recursive: true, force: true })
  mkdirSync(output, { recursive: true })
  cpSync(manifest, join(output, 'package.json'))
  cpSync(modules, join(output, 'node_modules'), { recursive: true })
  cpSync(catalog, join(output, 'plugins.json'))
  cpSync(workbenches, join(output, 'workbenches.json'))
  cpSync(tarballs, join(output, 'tarballs'), { recursive: true })
  const bin = join(output, 'node_modules', 'verdaccio', 'bin', 'verdaccio')
  if (!existsSync(bin)) throw new Error(`desktop plugin market: verdaccio was not installed at ${bin}`)
  assertRealTree(join(output, 'node_modules'))
}

/**
 * Reuse a cached npm install when the registry manifest is unchanged.
 * @param manifest - `market-registry/package.json`.
 * @returns The cached `node_modules` directory.
 */
function ensureModules(manifest: string): string {
  const stamp = createHash('sha256').update(readFileSync(manifest)).digest('hex')
  const modules = join(MODULE_CACHE, 'node_modules')
  const stampPath = join(MODULE_CACHE, 'stamp')
  const bin = join(modules, 'verdaccio', 'bin', 'verdaccio')
  if (existsSync(bin) && existsSync(stampPath) && readFileSync(stampPath, 'utf8') === stamp) {
    assertRealTree(modules)
    return modules
  }
  rmSync(MODULE_CACHE, { recursive: true, force: true })
  mkdirSync(MODULE_CACHE, { recursive: true })
  cpSync(manifest, join(MODULE_CACHE, 'package.json'))
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const result = spawnSync(npm, [
    'install', '--omit=dev', '--install-strategy=nested',
    '--registry', 'https://registry.npmjs.org/',
    '--no-fund', '--no-audit',
  ], {
    cwd: MODULE_CACHE,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: npmEnvironment(),
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`desktop plugin market: npm install exited ${String(result.status)}`)
  removeBinDirectories(modules)
  assertRealTree(modules)
  writeFileSync(stampPath, stamp)
  return modules
}

/** Drop peer-install and registry overrides so this install cannot be pointed at the private source. */
function npmEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env }
  for (const name of [
    'npm_config_registry', 'NPM_CONFIG_REGISTRY', 'PNPM_CONFIG_REGISTRY',
    'npm_config_auto_install_peers', 'pnpm_config_auto_install_peers',
    'NPM_CONFIG_AUTO_INSTALL_PEERS', 'PNPM_CONFIG_AUTO_INSTALL_PEERS',
  ]) delete environment[name]
  environment.npm_config_registry = 'https://registry.npmjs.org/'
  return environment
}

/** npm's nested layout has no package links. `.bin` shims are links and are not used at runtime. */
function removeBinDirectories(directory: string): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue
    if (!entry.isDirectory()) continue
    const path = join(directory, entry.name)
    if (entry.name === '.bin') rmSync(path, { recursive: true, force: true })
    else removeBinDirectories(path)
  }
}

/** @param directory - Tree that must survive being copied into an installer. */
function assertRealTree(directory: string): void {
  const pending = [directory]
  while (pending.length > 0) {
    const current = pending.pop()
    if (current === undefined) break
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isSymbolicLink()) throw new Error(`desktop plugin market: ${path} is a link and cannot be shipped`)
      if (entry.isDirectory()) pending.push(path)
    }
  }
}

main()
