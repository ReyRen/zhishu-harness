/** Deterministic model for keyless WeKnora conversation checks. */
import assert from 'node:assert/strict'
import { LlmAdapter } from '../../packages/llm/llm/lib/index.js'

export const calls = [
  ['weknora_list_knowledge_bases', {}],
  ['weknora_search', { query: 'How long are backups retained?' }],
  ['weknora_read_document', { knowledge_id: 'doc-backups' }],
  ['weknora_ask', { query: 'Summarize the backup policy.' }],
]

const selectedDescriptions = [
  'Show the knowledge bases explicitly selected by the user for this conversation.',
  'Search only the user-selected knowledge bases and return passages with document references. Do not widen the scope. Empty results mean no evidence was found.',
  'Read a document belonging to the user-selected knowledge bases, using its knowledge_id from retrieval.',
  'Ask WeKnora to compose a cited answer using only the user-selected knowledge bases. Uses a fresh scoped RAG session; custom agents, prior session IDs and web search are not allowed.',
]

export class KnowledgeModel extends LlmAdapter {
  async * stream(options) {
    for (const [index, [name]] of calls.entries()) {
      const tool = options.tools.find(tool => tool.name === name)
      assert.ok(tool, `${name} is model-visible`)
      // Independently installed upstream bundles retain their own descriptions.
      if (tool.description.startsWith('Show the knowledge bases explicitly') || options.tools.some(row => row.description === selectedDescriptions[0])) {
        assert.equal(tool.description, selectedDescriptions[index])
      }
    }
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
