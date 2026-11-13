/** Deterministic model for keyless WeKnora conversation checks. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { LlmAdapter } from '../../packages/llm/llm/lib/index.js'

export const calls = [
  ['weknora_list_knowledge_bases', {}],
  ['weknora_search', { query: 'How long are backups retained?' }],
  ['weknora_read_document', { knowledge_id: 'doc-backups' }],
  ['weknora_ask', { query: 'Summarize the backup policy.' }],
]

export const selectedCalls = [calls[0], ['weknora_overview', {}], ...calls.slice(1)]

export class KnowledgeModel extends LlmAdapter {
  async * stream(options) {
    const managed = options.tools.some(tool => tool.name === 'weknora_overview')
    const planned = managed ? selectedCalls : calls
    for (const [name] of planned) {
      const tool = options.tools.find(tool => tool.name === name)
      assert.ok(tool, `${name} is model-visible`)
    }
    const results = options.messages.filter(message => message.role === 'tool')
    if (results.length === 0) process.send?.({ knowledgePrompt: {
      system: options.system, messages: options.messages, tools: options.tools,
    } })
    if (managed && results.length === 0) {
      const section = options.messages.flatMap(message => message.source?.kind === 'runtime-context'
        ? message.source.sections ?? [] : []).find(section => section.name === 'knowledge:selected')
      assert.ok(section, 'selected retrieval is present in the first actual model request')
      const evidence = JSON.parse(section.text.split('\n').at(-1))
      assert.equal(typeof this.selectedBase, 'string')
      const expected = JSON.parse(readFileSync(new URL('./expected/weknora-context.json', import.meta.url), 'utf8')
        .replaceAll('<selected-base>', this.selectedBase))
      assert.deepEqual(evidence, expected, 'model-visible evidence matches the keyless context snapshot')
      assert.equal(evidence.status, 'retrieved')
      assert.equal(evidence.overview.total_documents, 1)
      assert.equal(evidence.passages[0].content, 'Backups are retained for 30 days.')
      assert.equal(evidence.overview.documents[0].parse_status, 'completed')
      const ask = options.tools.find(tool => tool.name === 'weknora_ask')
      for (const field of ['agent_id', 'session_id', 'web_search']) assert.equal(ask.parameters.properties[field], undefined)
    }
    const next = planned[results.length]
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
    assert.equal(results.length, planned.length)
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
