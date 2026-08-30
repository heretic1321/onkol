import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const root = resolve(import.meta.dir, '../..')
const source = readFileSync(resolve(root, 'runtime/codex/codex-bridge.js'), 'utf8')

describe('Codex bridge session status', () => {
  it('waits for Discord readiness before the automatic Codex turn', () => {
    expect(source).toContain('await startDiscordBot()')
    expect(source.indexOf('await startDiscordBot()')).toBeLessThan(
      source.indexOf('await initializeCodex()'),
    )
    expect(source).toContain('await client.login(BOT_TOKEN)')
    expect(source).toContain('await client.channels.fetch(CHANNEL_ID)')
  })

  it('keeps typing alive for every turn and stops on completion', () => {
    expect(source).toContain('await startTyping(channelId)')
    expect(source).toContain('setInterval(() =>')
    expect(source).toContain('case "turn/completed":')
    expect(source).toContain('stopTyping()')
  })

  it('uses one pinned, editable status message per session', () => {
    expect(source).toContain('statusMessageId')
    expect(source).toContain('fetchPinned()')
    expect(source).toContain('.edit(')
    expect(source).toContain('.pin()')
    expect(source).toContain('STATUS_CARD_MARKER')
  })

  it('renders protocol-backed metrics without inventing unavailable values', () => {
    expect(source).toContain('model/list')
    expect(source).toContain('thread/tokenUsage/updated')
    expect(source).toContain('account/rateLimits/read')
    expect(source).toContain('collabAgentToolCall')
    expect(source).toContain('Unavailable')
    expect(source).toContain('AUTO_COMPACT_PERCENT')
  })

  it('requires Manage Messages before pinning the status card', () => {
    expect(source).toContain('ManageMessages')
    expect(source).toContain('permissionsFor')
  })
})
