/** Start the per-container offline market before exposing the built native Web application. */
import { randomBytes } from 'node:crypto'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { serviceOwner, waitForService } from './services.mjs'

const root = '/opt/dsh'
const owner = serviceOwner()
const registry = 'http://127.0.0.1:4873'
const market = '/opt/dsh-market'
const state = await mkdtemp(join(tmpdir(), 'dsh-market-'))
let catalog
let requestedStop = false
const stop = () => {
  requestedStop = true
  owner.stop(new Error('Container is stopping'))
}
process.on('SIGTERM', stop)
process.on('SIGINT', stop)
try {
  await cp(join(market, 'storage'), join(state, 'storage'), { recursive: true })
  const indexPath = join(state, 'storage', '.verdaccio-db.json')
  const index = JSON.parse(await readFile(indexPath, 'utf8'))
  index.secret = randomBytes(16).toString('hex')
  await writeFile(indexPath, JSON.stringify(index), { mode: 0o600 })
  await writeFile(join(state, 'htpasswd'), '', { mode: 0o600 })
  await writeFile(join(state, 'verdaccio.yaml'), [
    `storage: ${JSON.stringify(join(state, 'storage'))}`,
    'auth:', '  htpasswd:', `    file: ${JSON.stringify(join(state, 'htpasswd'))}`, '    max_users: -1',
    'uplinks: {}',
    'packages:', '  "**":', '    access: $all', '    publish: $authenticated', '    unpublish: $authenticated',
    'web:', '  enable: false',
    'log:', '  type: stdout', '  format: pretty', '  level: warn',
    'listen: 127.0.0.1:4873', '',
  ].join('\n'), { mode: 0o600 })
  const files = {
    '/plugins.json': await readFile(join(market, 'plugins.json')),
    '/workbenches.json': await readFile(join(market, 'workbenches.json')),
  }
  catalog = createServer((request, response) => {
    const body = request.method === 'GET' ? files[request.url?.split('?')[0]] : undefined
    if (body === undefined) {
      response.writeHead(404).end()
      return
    }
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }).end(body)
  })
  await new Promise((resolve, reject) => {
    catalog.once('error', reject)
    catalog.listen(4874, '127.0.0.1', resolve)
  })
  catalog.on('error', error => owner.stop(error))
  owner.start(process.execPath, [join(root, 'market-registry/node_modules/verdaccio/bin/verdaccio'),
    '--config', join(state, 'verdaccio.yaml')])
  await waitForService(`${registry}/-/ping`, owner.signal)
  await waitForService('http://127.0.0.1:4874/plugins.json', owner.signal)
  await waitForService('http://127.0.0.1:4874/workbenches.json', owner.signal)
  const { DSH_WEB_PORT: webPort = '3080', DSH_INTERNAL_PORT: internalPort = '3081', DSH_PUBLIC_AUTHORITY: authority } = process.env
  if (!authority) throw new Error('DSH_PUBLIC_AUTHORITY is required')
  owner.start('socat', [`TCP-LISTEN:${internalPort},fork,reuseaddr,bind=0.0.0.0`, `TCP:127.0.0.1:${webPort}`])
  owner.start(process.execPath, [join(root, 'apps/cli/lib/bin.js'), '--profile', 'web',
    '--patch', join(root, 'docker/office.cordis.patch.yml'), '--host', '127.0.0.1', '--port', webPort,
    '--trusted-host', authority, '--no-open'], {
    env: { ...process.env, DSHM_REGISTRY_URL: 'http://127.0.0.1:4874/plugins.json', DSHM_NPM_MIRROR: registry,
      npm_config_auto_install_peers: 'false', pnpm_config_auto_install_peers: 'false',
      NPM_CONFIG_AUTO_INSTALL_PEERS: 'false', PNPM_CONFIG_AUTO_INSTALL_PEERS: 'false' },
  })
  await new Promise(resolve => {
    if (owner.signal.aborted) resolve()
    else owner.signal.addEventListener('abort', resolve, { once: true })
  })
  owner.signal.throwIfAborted()
} catch (error) {
  if (!requestedStop) {
    console.error('Native Web/offline market stopped; inspect startup dependencies and rebuild the image if assets are missing.', error)
    process.exitCode = 1
  }
} finally {
  await owner.close()
  if (catalog) await new Promise(resolve => {
    catalog.close(resolve)
    catalog.closeAllConnections()
  })
  await rm(state, { recursive: true, force: true })
  process.off('SIGTERM', stop)
  process.off('SIGINT', stop)
}
