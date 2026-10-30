/**
 * Host half of the workbench shell. The browser half occupies the slots and
 * calls Plugin Manager itself. This process only keeps the shared state file
 * and the read-only ownership service business servers consult.
 */
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createWorkbenchStateStore } from './state.mjs'

const headerImage = new URL('./assets/market-header.png', import.meta.url)

export const inject = ['connection']

function stateFile() {
  const home = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
  return join(home, 'desktop-workbenches', 'state.json')
}

function json(body, status = 200) {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } })
}

const CATALOG_BYTES = 2 * 1024 * 1024

function httpUrl(value, label) {
  let url
  try { url = new URL(value) } catch { /* checked below */ }
  if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:')) {
    const error = new Error(`${label}地址不正确。`)
    error.status = 500
    throw error
  }
  return url.href
}

function marketEndpoints() {
  return {
    catalog: httpUrl(process.env.ZHISHU_WORKBENCH_CATALOG_URL?.trim() || 'http://127.0.0.1:4874/workbenches.json', '工作台目录'),
    registry: httpUrl(process.env.DSHM_NPM_MIRROR?.trim() || 'http://127.0.0.1:4873', '工作台安装源').replace(/\/$/, ''),
  }
}

function repositoryIdentity(repository) {
  if (typeof repository !== 'string') return null
  const match = repository.trim().replace(/^git\+/i, '').match(/^(?:https:\/\/github\.com\/|git:\/\/github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/i)
  return match ? `${match[1]}/${match[2]}`.toLowerCase() : null
}

function listedWorkbenches(document) {
  if (!document || typeof document !== 'object' || Array.isArray(document) || !Array.isArray(document.workbenches)) {
    const error = new Error('工作台目录格式不正确。')
    error.status = 502
    throw error
  }
  const categories = document.categories && typeof document.categories === 'object' && !Array.isArray(document.categories)
    ? document.categories
    : {}
  return document.workbenches.flatMap(entry => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
    const id = repositoryIdentity(entry.url)
    if (!id || typeof entry.npm !== 'string' || entry.npm === '' || typeof entry.version !== 'string' || entry.version === '' || typeof entry.name !== 'string' || entry.name === '') {
      return []
    }
    const category = categories[entry.category]
    const description = entry.description && typeof entry.description === 'object' ? entry.description.zh || entry.description.en || '' : ''
    const screenshots = Array.isArray(entry.screenshots) ? entry.screenshots.flatMap(item => {
      const url = typeof item === 'string' ? item : item?.url
      return typeof url === 'string' && /^https:\/\//.test(url) ? [url] : []
    }).slice(0, 5) : []
    return [{
      id,
      name: entry.name,
      url: entry.url,
      npm: entry.npm,
      version: entry.version,
      owner: typeof entry.owner === 'string' ? entry.owner : '',
      categoryId: typeof entry.category === 'string' ? entry.category : '',
      category: category && typeof category === 'object' ? category.zh || category.en || '' : '',
      description: typeof description === 'string' ? description : '',
      stars: Number.isSafeInteger(entry.stars) && entry.stars >= 0 ? entry.stars : null,
      downloads: Number.isSafeInteger(entry.downloads) && entry.downloads >= 0 ? entry.downloads : null,
      updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : '',
      screenshots,
    }]
  })
}

function listedCategories(document) {
  const categories = document.categories
  if (!categories || typeof categories !== 'object' || Array.isArray(categories)) return []
  return Object.entries(categories).flatMap(([id, name]) => {
    if (!id || !name || typeof name !== 'object') return []
    const label = name.zh || name.en
    return typeof label === 'string' && label !== '' ? [{ id, name: label }] : []
  })
}

async function readMarketCatalog() {
  const endpoints = marketEndpoints()
  let response
  try {
    response = await fetch(endpoints.catalog, { signal: AbortSignal.timeout(15_000) })
  } catch {
    const error = new Error('无法读取工作台目录。')
    error.status = 502
    throw error
  }
  if (!response.ok) {
    const error = new Error('无法读取工作台目录。')
    error.status = 502
    throw error
  }
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length > CATALOG_BYTES) {
    const error = new Error('工作台目录过大。')
    error.status = 502
    throw error
  }
  let document
  try { document = JSON.parse(bytes.toString('utf8')) }
  catch {
    const error = new Error('工作台目录格式不正确。')
    error.status = 502
    throw error
  }
  return { registry: endpoints.registry, categories: listedCategories(document), workbenches: listedWorkbenches(document) }
}

/**
 * @param ctx - host context. `connection` publishes the state routes.
 */
export function apply(ctx) {
  const store = createWorkbenchStateStore(stateFile())
  ctx.effect(() => ctx.reflect.provide('desktopWorkbenchOwnership', {
    async read() {
      const { revision, state } = await store.read()
      return {
        revision,
        sessionBindings: { ...state.sessionBindings },
        added: [...state.added],
      }
    },
  }), 'zhishu-workbenches: ownership')
  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/desktop-workbenches/state',
    methods: ['GET'],
    requestBody: 'buffered',
    async fetch() {
      try {
        return json(await store.read())
      } catch (error) {
        ctx.logger?.warn?.('Could not read workbench state: %s', error?.message ?? error)
        return json({ error: '无法读取工作台状态。' }, 500)
      }
    },
  }), 'zhishu-workbenches: state')
  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/desktop-workbenches/state/write',
    methods: ['POST'],
    requestBody: 'buffered',
    async fetch(request) {
      try {
        return json(await store.write(await request.json()))
      } catch (error) {
        const status = Number.isInteger(error?.status) ? error.status : 500
        return json({ error: error?.message || '无法保存工作台状态。' }, status)
      }
    },
  }), 'zhishu-workbenches: state write')
  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/desktop-workbenches/catalog',
    methods: ['GET'],
    requestBody: 'buffered',
    async fetch() {
      try {
        return json(await readMarketCatalog())
      } catch (error) {
        const status = Number.isInteger(error?.status) ? error.status : 502
        return json({ error: error?.message || '无法读取工作台目录。' }, status)
      }
    },
  }), 'zhishu-workbenches: catalog')
  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/desktop-workbenches/assets/market-header.png',
    methods: ['GET'],
    requestBody: 'buffered',
    async fetch() {
      try {
        const image = await readFile(headerImage)
        return new Response(image, { headers: { 'content-type': 'image/png', 'cache-control': 'no-cache' } })
      } catch {
        return json({ error: '无法读取工作台页头图片。' }, 500)
      }
    },
  }), 'zhishu-workbenches: header')
}
