/** Check locked downloads, cache reuse and npm policy metadata without public network access. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { prepareOfflineDependencies } from '../../market-registry/prepare-offline-dependencies.mjs'

async function fixture(t, change = {}) {
  const root = await mkdtemp(join(tmpdir(), 'offline-dependency-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const bytes = Buffer.from('locked package bytes')
  const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`
  const item = { name: '@example/runtime', version: '1.0.0', integrity, ...change }
  const lockPath = join(root, 'lock.json')
  await writeFile(lockPath, JSON.stringify({ version: 1, packages: [item] }))
  const manifest = { name: '@example/runtime', version: '1.0.0',
    dist: { integrity, tarball: 'https://registry.npmjs.org/@example/runtime/-/runtime-1.0.0.tgz',
      signatures: [{ keyid: 'reviewed-registry-key', sig: 'original-signature' }] } }
  const document = { name: '@example/runtime', versions: { '1.0.0': manifest }, time: { '1.0.0': '2026-01-01T00:00:00.000Z' } }
  const requests = []
  const fetchImpl = async url => {
    requests.push(url)
    return String(url).endsWith('.tgz') ? new Response(bytes) : Response.json(document)
  }
  return { root, bytes, integrity, manifest, document, requests, options: { lockPath, tarballsDir: join(root, 'tarballs'), fetchImpl } }
}

test('keeps original publication time and registry signatures beside verified tarballs', async t => {
  const f = await fixture(t)
  assert.equal(await prepareOfflineDependencies(f.options), 1)
  const name = 'example-runtime-1.0.0.tgz'
  assert.deepEqual(await readFile(join(f.options.tarballsDir, name)), f.bytes)
  const metadata = JSON.parse(await readFile(join(f.options.tarballsDir, 'registry-metadata.json'), 'utf8'))
  assert.deepEqual(metadata[name], { manifest: f.manifest, publishedAt: '2026-01-01T00:00:00.000Z' })
  f.requests.length = 0
  await prepareOfflineDependencies(f.options)
  assert.equal(f.requests.length, 1, 'Cached tarballs still obtain current registry policy metadata')
})

test('rejects a downloaded tarball whose bytes differ from the locked integrity', async t => {
  const f = await fixture(t)
  const wrong = `sha512-${createHash('sha512').update('other bytes').digest('base64')}`
  await writeFile(f.options.lockPath, JSON.stringify({ version: 1, packages: [{ name: '@example/runtime', version: '1.0.0', integrity: wrong }] }))
  f.manifest.dist.integrity = wrong
  await assert.rejects(prepareOfflineDependencies(f.options), /integrity mismatch/u)
})

test('rejects cache corruption instead of serving changed package bytes', async t => {
  const f = await fixture(t)
  await prepareOfflineDependencies(f.options)
  await writeFile(join(f.options.tarballsDir, 'example-runtime-1.0.0.tgz'), 'corrupt cache')
  await assert.rejects(prepareOfflineDependencies(f.options), /integrity mismatch/u)
})

test('rejects metadata with a changed version or integrity', async t => {
  const f = await fixture(t)
  f.manifest.version = '2.0.0'
  await assert.rejects(prepareOfflineDependencies(f.options), /metadata does not match the lock/u)
})

test('requires the original publication time for package-manager policy checks', async t => {
  const f = await fixture(t)
  delete f.document.time['1.0.0']
  await assert.rejects(prepareOfflineDependencies(f.options), /metadata does not match the lock/u)
})

test('fails on missing registry metadata and missing tarballs', async t => {
  const f = await fixture(t)
  await assert.rejects(prepareOfflineDependencies({ ...f.options, fetchImpl: async () => new Response('', { status: 404 }) }), /metadata unavailable/u)
  await assert.rejects(prepareOfflineDependencies({ ...f.options,
    fetchImpl: async url => String(url).endsWith('.tgz') ? new Response('', { status: 404 }) : Response.json(f.document) }), /tarball unavailable/u)
})

test('rejects invalid package names, versions and duplicate lock entries', async t => {
  const f = await fixture(t, { name: '../escape' })
  await assert.rejects(prepareOfflineDependencies(f.options), /Invalid locked offline dependency/u)
  const entry = { name: '@example/runtime', version: '1.0.0', integrity: f.integrity }
  await writeFile(f.options.lockPath, JSON.stringify({ version: 1, packages: [entry, entry] }))
  await assert.rejects(prepareOfflineDependencies(f.options), /Duplicate offline dependency/u)
})

test('refuses a metadata tarball URL outside the public npm registry', async t => {
  const f = await fixture(t)
  f.manifest.dist.tarball = 'https://untrusted.example/runtime.tgz'
  await assert.rejects(prepareOfflineDependencies(f.options), /outside the npm registry/u)
})
