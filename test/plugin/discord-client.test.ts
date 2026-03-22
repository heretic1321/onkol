import { describe, it, expect } from 'bun:test'
import { shouldForwardMessage } from '../../src/plugin/discord-client'

describe('shouldForwardMessage', () => {
  const channelId = '123456'
  const allowedUsers = ['user1', 'user2']

  it('forwards messages from correct channel and allowed user', () => {
    expect(shouldForwardMessage('123456', 'user1', false, channelId, allowedUsers)).toBe(true)
  })

  it('rejects messages from wrong channel', () => {
    expect(shouldForwardMessage('999999', 'user1', false, channelId, allowedUsers)).toBe(false)
  })

  it('rejects messages from disallowed user', () => {
    expect(shouldForwardMessage('123456', 'user3', false, channelId, allowedUsers)).toBe(false)
  })

  it('rejects bot messages', () => {
    expect(shouldForwardMessage('123456', 'user1', true, channelId, allowedUsers)).toBe(false)
  })

  it('allows any user when allowlist is empty', () => {
    expect(shouldForwardMessage('123456', 'anyone', false, channelId, [])).toBe(true)
  })
})
