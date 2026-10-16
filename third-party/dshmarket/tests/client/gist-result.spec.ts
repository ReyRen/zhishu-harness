import { describe, expect, it } from 'vitest'
import { isGistExportResult } from '../../src/client/market-data.ts'

describe('Gist export response boundary', () => {
  it('keeps valid response identity and extra server fields', () => {
    const response = { ok: true, gistId: 'test-id', gistUrl: 'https://gist.github.com/test-id', extra: 'preserved' }
    expect(isGistExportResult(response)).toBe(true)
    expect(response.extra).toBe('preserved')
  })
  it.each([null, undefined, [], 0, '', {}, { ok: true },
    { ok: 'true', gistId: 'id', gistUrl: 'url' },
    { ok: true, gistId: 123, gistUrl: 'url' },
    { ok: true, gistId: 'id', gistUrl: null },
  ])('rejects malformed response %j', (value) => {
    expect(isGistExportResult(value)).toBe(false)
  })
})
