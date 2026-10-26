import { describe, expect, it } from 'vitest'
import { classifyModelAddress } from '../src/model-space/model-address.ts'

const origin = 'http://127.0.0.1:17321'

describe('model page address', () => {
  it.each(['/login', '/login/', '/register', '/', '/404'])('keeps %s covered', (path) => {
    expect(classifyModelAddress(`${origin}${path}`, origin)).toBe('signed-out')
  })

  it('keeps the cold-start entry and identity form covered', () => {
    expect(classifyModelAddress(`${origin}/desktop-entry`, origin)).toBe('pending')
    expect(classifyModelAddress(`${origin}/complete-identity`, origin)).toBe('pending')
  })

  it('opens the conversation from a workspace path', () => {
    expect(classifyModelAddress(`${origin}/smartChat?dialog=true`, origin)).toBe('signed-in')
    expect(classifyModelAddress(`${origin}/dashboard`, origin)).toBe('signed-in')
  })

  it('covers an http page that has left the model origin', () => {
    expect(classifyModelAddress('https://172.18.127.67/login', origin)).toBe('signed-out')
    expect(classifyModelAddress('http://127.0.0.1:8888/login', origin)).toBe('signed-out')
  })

  it('ignores internal documents', () => {
    expect(classifyModelAddress('about:blank', origin)).toBe('ignore')
    expect(classifyModelAddress('not a url', origin)).toBe('ignore')
  })
})
