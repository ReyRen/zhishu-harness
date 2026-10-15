/**
 * Start `dsh web` against the local market registry.
 * `DSHM_*` begins with `DSH_`, so a project `.env` is not allowed to set it.
 */
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const catalog = 'http://127.0.0.1:4874/plugins.json'
const mirror = 'http://127.0.0.1:4873'

const probe = await fetch(catalog).catch(error => {
  console.error(`private catalog is not running (${error instanceof Error ? error.message : error})`)
  console.error('start it first: pnpm market:registry')
  process.exit(1)
})
if (!probe.ok) {
  console.error(`private catalog answered ${probe.status}. Start it with: pnpm market:registry`)
  process.exit(1)
}

const extra = process.argv.slice(2)
const child = spawn(process.execPath, [
  '--import', 'tsx/esm', join(repo, 'apps/cli/src/bin.ts'), 'web', ...extra,
], {
  cwd: repo,
  stdio: 'inherit',
  env: {
    ...process.env,
    DSHM_REGISTRY_URL: catalog,
    DSHM_NPM_MIRROR: mirror,
    // Peer packages belong to the host. Do not ask the private registry for them.
    npm_config_auto_install_peers: 'false',
    pnpm_config_auto_install_peers: 'false',
  },
})
child.on('exit', code => process.exit(code ?? 1))
