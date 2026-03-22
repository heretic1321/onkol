import { describe, it, expect } from 'bun:test'
import { buildCreateCategoryPayload, buildCreateChannelPayload } from '../../src/cli/discord-api'

describe('Discord API payload builders', () => {
  it('builds category creation payload', () => {
    const payload = buildCreateCategoryPayload('loyalty-voicebot')
    expect(payload).toEqual({
      name: 'loyalty-voicebot',
      type: 4,
    })
  })

  it('builds channel creation payload under a category', () => {
    const payload = buildCreateChannelPayload('fix-auth', '999')
    expect(payload).toEqual({
      name: 'fix-auth',
      type: 0,
      parent_id: '999',
    })
  })

  it('sanitizes channel names (lowercase, hyphens)', () => {
    const payload = buildCreateChannelPayload('Fix Auth Bug!', '999')
    expect(payload.name).toBe('fix-auth-bug')
  })
})
