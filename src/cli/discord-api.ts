const DISCORD_API = 'https://discord.com/api/v10'

function sanitizeChannelName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100)
}

export function buildCreateCategoryPayload(name: string) {
  return { name, type: 4 }
}

export function buildCreateChannelPayload(name: string, parentId: string) {
  return { name: sanitizeChannelName(name), type: 0, parent_id: parentId }
}

export async function createCategory(token: string, guildId: string, name: string): Promise<{ id: string; name: string }> {
  const res = await fetch(`${DISCORD_API}/guilds/${guildId}/channels`, {
    method: 'POST',
    headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(buildCreateCategoryPayload(name)),
  })
  if (!res.ok) throw new Error(`Failed to create category: ${res.status} ${await res.text()}`)
  return res.json()
}

export async function createChannel(token: string, guildId: string, name: string, parentId: string): Promise<{ id: string; name: string }> {
  const res = await fetch(`${DISCORD_API}/guilds/${guildId}/channels`, {
    method: 'POST',
    headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(buildCreateChannelPayload(name, parentId)),
  })
  if (!res.ok) throw new Error(`Failed to create channel: ${res.status} ${await res.text()}`)
  return res.json()
}

export async function deleteChannel(token: string, channelId: string): Promise<void> {
  const res = await fetch(`${DISCORD_API}/channels/${channelId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bot ${token}` },
  })
  if (!res.ok && res.status !== 404) {
    throw new Error(`Failed to delete channel: ${res.status} ${await res.text()}`)
  }
}

export async function sendMessage(token: string, channelId: string, content: string): Promise<void> {
  const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  })
  if (!res.ok) throw new Error(`Failed to send message: ${res.status} ${await res.text()}`)
}
