import { createServer } from 'node:http'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ensureGatewayConfig,
  matchRoute,
  MODEL_HARNESS_PORT,
  MODEL_SITE_ORIGIN,
  MODEL_SITE_PORT,
  readGatewayConfig,
  resolveUpstream,
  startModelGateway,
  type GatewayRoute,
} from '../src/model-space/model-gateway.ts'
import { PACKAGED_MODEL_ORIGIN } from '../scripts/model-origin.mjs'

const routes: readonly GatewayRoute[] = [
  { prefix: '/api/v1/', target: 'http://172.18.29.80:8091' },
  { prefix: '/api', target: 'http://172.18.127.66' },
  { prefix: '/DistributedAISystem/', target: 'http://172.18.127.67:8018' },
  { prefix: '/RAGFlow/', target: 'http://172.18.127.67:5580', replace: '/v1/' },
  { prefix: '/promptApi/', target: 'http://172.18.127.43:8082', replace: '/' },
]

describe('model gateway routes', () => {
  it('keeps the packaged page origin on the local gateway', () => {
    expect(PACKAGED_MODEL_ORIGIN).toBe(MODEL_SITE_ORIGIN)
    expect(MODEL_SITE_PORT).toBe(17321)
    expect(MODEL_HARNESS_PORT).toBe(3002)
  })

  it('selects the longest matching backend', () => {
    expect(matchRoute('/api/v1/plugins', routes)?.target).toBe('http://172.18.29.80:8091')
    expect(matchRoute('/api/conversations', routes)?.target).toBe('http://172.18.127.66')
    expect(matchRoute('/promptRepo', routes)).toBeUndefined()
  })

  it('rewrites a prefix when the backend path differs', () => {
    const grades = resolveUpstream(routes[2]!, '/DistributedAISystem/grades', '?class=1')
    expect(grades.href).toBe('http://172.18.127.67:8018/DistributedAISystem/grades?class=1')
    const rag = resolveUpstream(routes[3]!, '/RAGFlow/datasets', '')
    expect(rag.href).toBe('http://172.18.127.67:5580/v1/datasets')
    const prompt = resolveUpstream(routes[4]!, '/promptApi/v1/spaces', '')
    expect(prompt.href).toBe('http://172.18.127.43:8082/v1/spaces')
  })
})

describe('model gateway server', () => {
  const directories: string[] = []
  const closers: Array<() => Promise<void>> = []

  afterEach(async () => {
    await Promise.all(closers.splice(0).map(close => close()))
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
  })

  it('serves the packaged page and proxies an API through the edited config', async () => {
    const root = mkdtempSync(join(tmpdir(), 'model-gateway-'))
    directories.push(root)
    const resources = join(root, 'resources')
    const site = join(resources, 'model-site')
    mkdirSync(join(site, 'app'), { recursive: true })
    writeFileSync(join(site, 'app', 'index.html'), '<p>model</p>')
    writeFileSync(join(site, 'gateway.default.json'), JSON.stringify({
      upstreams: [{ prefix: '/DistributedAISystem/', target: 'http://127.0.0.1:9' }],
      harness: { target: 'http://127.0.0.1:9' },
    }))
    const backend = createServer((request, response) => {
      response.setHeader('set-cookie', 'JSESSIONID=abc; Domain=172.18.127.67; Path=/')
      response.end(JSON.stringify({
        url: request.url,
        host: request.headers.host,
        origin: request.headers.origin,
        referer: request.headers.referer,
      }))
    })
    await new Promise<void>((resolve) => { backend.listen(0, '127.0.0.1', resolve) })
    closers.push(() => new Promise((resolve, reject) => { backend.close((error) => { if (error) reject(error); else resolve() }) }))
    const address = backend.address()
    if (address === null || typeof address === 'string') throw new Error('backend port missing')
    const configPath = ensureGatewayConfig(resources)
    const config = JSON.parse(readFileSync(configPath, 'utf8')) as { upstreams: Array<{ target: string }> }
    config.upstreams[0]!.target = `http://127.0.0.1:${String(address.port)}`
    writeFileSync(configPath, JSON.stringify({ ...config, harness: { target: `http://127.0.0.1:${String(address.port)}` } }))
    expect(ensureGatewayConfig(resources)).toBe(configPath)
    const gateway = await startModelGateway({ siteDir: site, configPath })
    closers.push(() => gateway.close())
    const page = await fetch(`${gateway.origin}/login`)
    expect(await page.text()).toBe('<p>model</p>')
    const api = await fetch(`${gateway.origin}/DistributedAISystem/grades`, {
      headers: { origin: 'http://127.0.0.1:17321', referer: 'http://127.0.0.1:17321/login' },
    })
    expect(await api.json()).toEqual({
      url: '/DistributedAISystem/grades',
      host: '172.18.127.67',
      origin: 'https://172.18.127.67',
      referer: 'https://172.18.127.67/login',
    })
    expect(api.headers.get('set-cookie')).toBe('JSESSIONID=abc; Path=/')
    const parsed = readGatewayConfig(configPath)
    expect(parsed.harness.target).toContain('127.0.0.1')
  })
})
