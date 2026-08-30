import { describe, it, expect } from 'bun:test'
import { parseNodePrefix, shouldForwardMessage } from '../../src/plugin/discord-client'

describe('parseNodePrefix', () => {
  it('returns the source node and strips its prefix from forwarded content', () => {
    expect(parseNodePrefix('[worker-b] task completed')).toEqual({
      nodeName: 'worker-b',
      content: 'task completed',
    })
  })

  it('rejects missing, malformed, and non-string prefixes', () => {
    expect(parseNodePrefix('task completed')).toBeNull()
    expect(parseNodePrefix('[worker b] task completed')).toBeNull()
    expect(parseNodePrefix('[] task completed')).toBeNull()
    expect(parseNodePrefix(undefined)).toBeNull()
  })
})

describe('shouldForwardMessage', () => {
  const channelId = '123456'
  const allowedUsers = ['user1', 'user2']
  const botUserId = 'onkol-bot'
  const nodeName = 'worker-a'

  const shouldForward = (
    authorId: string,
    isBot: boolean,
    messageContent = '',
    sourceBotUserId: string | null = botUserId,
  ) => shouldForwardMessage(
    channelId,
    authorId,
    isBot,
    channelId,
    allowedUsers,
    sourceBotUserId,
    nodeName,
    messageContent,
  )

  it('forwards messages from the correct channel and allowed human', () => {
    expect(shouldForward('user1', false, 'hello')).toBe(true)
  })

  it('rejects messages from the wrong channel', () => {
    expect(shouldForwardMessage('999999', 'user1', false, channelId, allowedUsers, botUserId, nodeName, 'hello')).toBe(false)
  })

  it('rejects messages from a disallowed human', () => {
    expect(shouldForward('user3', false, 'hello')).toBe(false)
  })

  it('allows any human when the allowlist is empty', () => {
    expect(shouldForwardMessage(channelId, 'anyone', false, channelId, [], botUserId, nodeName, 'hello')).toBe(true)
  })

  it('forwards a prefixed message from this bridge bot when it came from another node', () => {
    expect(shouldForward(botUserId, true, '[worker-b] hello')).toBe(true)
  })

  it('rejects messages from another bot even when they have a node prefix', () => {
    expect(shouldForward('other-bot', true, '[worker-b] hello')).toBe(false)
  })

  it('rejects this bridge bot messages addressed from the same node', () => {
    expect(shouldForward(botUserId, true, '[worker-a] hello')).toBe(false)
  })

  it('rejects this bridge bot messages without a valid node prefix', () => {
    expect(shouldForward(botUserId, true, 'hello')).toBe(false)
    expect(shouldForward(botUserId, true, '[worker a] hello')).toBe(false)
  })

  it('rejects bot messages when the bridge identity is unavailable', () => {
    expect(shouldForward(botUserId, true, '[worker-b] hello', null)).toBe(false)
  })

  it('keeps the original five-argument human call safe', () => {
    expect(shouldForwardMessage(channelId, 'user1', false, channelId, allowedUsers)).toBe(true)
    expect(shouldForwardMessage(channelId, botUserId, true, channelId, allowedUsers)).toBe(false)
  })
})
