import { describe, expect, it } from 'vitest'
import { readModelSpaceState } from '../src/model-space/model-space.ts'

describe('model space IPC state', () => {
  it.each([null, undefined, 0, '', [], {}, { active: 'other', authenticated: true },
    { active: 'business', authenticated: 'true' }, { active: 'conversation' }])('ignores malformed state %j', (value) => {
    expect(readModelSpaceState(value)).toBeUndefined()
  })
  it.each(['conversation', 'business'] as const)('accepts %s independently of authentication', (active) => {
    for (const authenticated of [true, false]) {
      expect(readModelSpaceState({ active, authenticated })).toEqual({ active, authenticated })
    }
  })
})
