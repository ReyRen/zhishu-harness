/** Pin the scoped Docker 24 policy; other syscall exceptions fail this build check. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const policy = JSON.parse(readFileSync(new URL('../security/seccomp-bwrap.json', import.meta.url), 'utf8'))
const baselineHash = 'fafe2be3eaa5b65942ab36f23b3da584f2744464fc7d7458972d82672873e876'
function validate(value) {
  assert.equal(value.defaultAction, 'SCMP_ACT_ERRNO')
  assert.equal(createHash('sha256').update(JSON.stringify(value.syscalls.slice(0, -2))).digest('hex'), baselineHash)
  assert.deepEqual(value.syscalls.slice(-2), [
    { names: ['mount', 'pivot_root', 'umount2'], action: 'SCMP_ACT_ALLOW' },
    { names: ['clone'], action: 'SCMP_ACT_ALLOW', args: [{ index: 0, value: 0x30020011, op: 'SCMP_CMP_EQ' }] },
  ])
}
test('preserves Moby syscall rules and limits additional namespace flags', () => { validate(policy) })
test('rejects unrestricted namespace creation or an altered default rule', () => {
  for (const mutate of [
    p => { p.defaultAction = 'SCMP_ACT_ALLOW' },
    p => { delete p.syscalls.at(-1).args },
    p => { p.syscalls.at(-2).names.push('unshare') },
    p => { p.syscalls[0].names.push('setns') },
  ]) {
    const changed = structuredClone(policy)
    mutate(changed)
    assert.throws(() => { validate(changed) })
  }
})
test('retains sensitive kernel-path denials in the named AppArmor profile', () => {
  const profile = readFileSync(new URL('../security/apparmor-bwrap', import.meta.url), 'utf8')
  for (const text of ['profile gcs-harness-bwrap ', 'deny @{PROC}/kcore ',
    'deny /proc/{asound,acpi,keys,latency_stats,timer_list,timer_stats,sched_debug,scsi}',
    'deny /sys/kernel/security/**', 'deny /proc/{bus,fs,irq,sys}']) assert.ok(profile.includes(text))
})
