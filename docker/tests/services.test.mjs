/** Exercise real process ownership, readiness rejection and quiescent shutdown. */
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { serviceOwner, waitForService } from '../services.mjs'

test('an unexpected successful child exit aborts the remaining services', async () => {
  const owner = serviceOwner()
  try {
    const other = owner.start(process.execPath, ['-e', 'setInterval(() => {}, 1000)'])
    const child = owner.start(process.execPath, ['-e', 'process.exit(0)'])
    await once(child, 'close')
    assert.equal(owner.signal.aborted, true)
    assert.match(owner.signal.reason.message, /exited unexpectedly/u)
    await owner.close()
    assert.notEqual(other.signalCode, null)
    assert.equal(owner.close(), owner.close())
  } finally { await owner.close() }
})

test('an executable error aborts startup and is awaited during teardown', async () => {
  const owner = serviceOwner()
  try {
    owner.start('/this-executable-does-not-exist', [])
    await new Promise(resolve => owner.signal.addEventListener('abort', resolve, { once: true }))
    assert.match(owner.signal.reason.message, /Cannot start/u)
    assert.throws(() => owner.start(process.execPath, []), /Cannot start/u)
  } finally { await owner.close() }
})

test('readiness requires HTTP success and responds to cancellation', async () => {
  const server = createServer((_request, response) => response.writeHead(404).end())
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  try {
    const url = `http://127.0.0.1:${server.address().port}`
    await assert.rejects(waitForService(url, new AbortController().signal, 150), /Service unavailable/u)
    const controller = new AbortController()
    controller.abort(new Error('startup cancelled'))
    await assert.rejects(waitForService(url, controller.signal), /startup cancelled/u)
  } finally {
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections() })
  }
})
