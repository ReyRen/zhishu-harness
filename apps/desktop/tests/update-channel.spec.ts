import { expect, it } from 'vitest'
import { desktopUpdateChannel, desktopUpdateVerifiesCodeSignature } from '../src/update-channel.ts'

it('reads the installed channel independently from the current version', () => {
  expect(desktopUpdateChannel({ version: '1.0.0', dshDesktopUpdateChannel: 'nightly' })).toBe('nightly')
  expect(desktopUpdateChannel({ version: '1.0.0', dshDesktopUpdateChannel: 'latest' })).toBe('latest')
  expect(desktopUpdateChannel({ version: '1.0.0' })).toBe('nightly')
  expect(() => desktopUpdateChannel({ dshDesktopUpdateChannel: 'beta' })).toThrow(/channel/u)
  expect(() => desktopUpdateChannel(null)).toThrow(/manifest/u)
})

it('verifies downloaded publishers unless an unsigned package opts out', () => {
  expect(desktopUpdateVerifiesCodeSignature({ dshDesktopUpdateChannel: 'nightly' })).toBe(true)
  expect(desktopUpdateVerifiesCodeSignature({ dshDesktopVerifyUpdateSignature: false })).toBe(false)
  expect(desktopUpdateVerifiesCodeSignature({ dshDesktopVerifyUpdateSignature: true })).toBe(true)
  expect(() => desktopUpdateVerifiesCodeSignature({ dshDesktopVerifyUpdateSignature: 'no' })).toThrow(/signature/u)
  expect(() => desktopUpdateVerifiesCodeSignature(null)).toThrow(/manifest/u)
})
