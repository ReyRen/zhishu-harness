import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DESKTOP_WEKNORA_BASE_URL,
  withDesktopWeknoraEnvironment,
} from '../src/weknora-environment.ts'

describe('withDesktopWeknoraEnvironment', () => {
  it('fills the platform default when unset', () => {
    const next = withDesktopWeknoraEnvironment({})
    expect(next.WEKNORA_BASE_URL).toBe(DEFAULT_DESKTOP_WEKNORA_BASE_URL)
  })

  it('keeps an explicit override', () => {
    const next = withDesktopWeknoraEnvironment({ WEKNORA_BASE_URL: 'http://127.0.0.1:9/api/v1' })
    expect(next.WEKNORA_BASE_URL).toBe('http://127.0.0.1:9/api/v1')
  })

  it('trims whitespace-only values back to the default', () => {
    const next = withDesktopWeknoraEnvironment({ WEKNORA_BASE_URL: '   ' })
    expect(next.WEKNORA_BASE_URL).toBe(DEFAULT_DESKTOP_WEKNORA_BASE_URL)
  })
})
