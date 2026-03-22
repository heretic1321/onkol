import { describe, it, expect, beforeEach } from 'bun:test'
import { MessageBatcher } from '../../src/plugin/message-batcher'

describe('MessageBatcher', () => {
  let batcher: MessageBatcher
  let sent: string[]

  beforeEach(() => {
    sent = []
    batcher = new MessageBatcher(async (text: string) => {
      sent.push(text)
    }, 50)
  })

  it('sends a single message after buffer delay', async () => {
    batcher.enqueue('hello')
    expect(sent).toHaveLength(0)
    await new Promise(r => setTimeout(r, 100))
    expect(sent).toHaveLength(1)
    expect(sent[0]).toBe('hello')
  })

  it('combines rapid messages into one', async () => {
    batcher.enqueue('line 1')
    batcher.enqueue('line 2')
    batcher.enqueue('line 3')
    await new Promise(r => setTimeout(r, 100))
    expect(sent).toHaveLength(1)
    expect(sent[0]).toBe('line 1\nline 2\nline 3')
  })

  it('sends separately if gap exceeds buffer time', async () => {
    batcher.enqueue('first')
    await new Promise(r => setTimeout(r, 100))
    batcher.enqueue('second')
    await new Promise(r => setTimeout(r, 100))
    expect(sent).toHaveLength(2)
  })

  it('truncates messages over 2000 chars (Discord limit)', async () => {
    const long = 'x'.repeat(2500)
    batcher.enqueue(long)
    await new Promise(r => setTimeout(r, 100))
    expect(sent[0].length).toBeLessThanOrEqual(2000)
    expect(sent[0]).toContain('... (truncated)')
  })
})
