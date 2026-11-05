/** Deterministic model for keyless WeKnora conversation checks. */
import assert from 'node:assert/strict'
import { LlmAdapter } from '../../packages/llm/llm/lib/index.js'

export const calls = [
  ['weknora_list_knowledge_bases', {}],
  ['weknora_search', { query: 'How long are backups retained?' }],
  ['weknora_read_document', { knowledge_id: 'doc-backups' }],
  ['weknora_ask', { query: 'Summarize the backup policy.' }],
]

export class KnowledgeModel extends LlmAdapter {
  async * stream(options) {
    for (const [name] of calls) assert.ok(options.tools.some(tool => tool.name === name), `${name} is model-visible`)
    const results = options.messages.filter(message => message.role === 'tool')
    const next = calls[results.length]
    if (next) {
      const [name, args] = next
      const id = `weknora-call-${results.length}`
      const argumentsText = JSON.stringify(args)
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: argumentsText }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: argumentsText } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    assert.equal(results.length, calls.length)
    for (const result of results) assert.equal(result.isError, false, JSON.stringify(result.content))
    const evidence = results.flatMap(result => result.content).filter(block => block.type === 'text').map(block => block.text).join('\n')
    assert.match(evidence, /Backups are retained for 30 days/u)
    const text = 'Backups are retained for 30 days. Source: Backup policy.'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}
