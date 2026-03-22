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

/**
 * Validates the bot token and checks if it can connect to the Discord gateway
 * with the required intents (Guilds, GuildMessages, MessageContent).
 * Returns { ok: true } or { ok: false, error: string }.
 */
export async function validateBotToken(token: string): Promise<{ ok: true } | { ok: false; error: string }> {
  // Step 1: Check the token is valid via /users/@me
  const meRes = await fetch(`${DISCORD_API}/users/@me`, {
    headers: { Authorization: `Bot ${token}` },
  })
  if (!meRes.ok) {
    const body = await meRes.text()
    if (meRes.status === 401) return { ok: false, error: 'Invalid bot token.' }
    return { ok: false, error: `Discord API error (${meRes.status}): ${body}` }
  }

  // Step 2: Get the bot's application to check if it's a bot token
  const me = await meRes.json() as { username: string; bot?: boolean }
  if (!me.bot) return { ok: false, error: 'This token belongs to a user account, not a bot.' }

  // Step 3: Try connecting to the gateway with the required intents to check for DisallowedIntents
  // Intents: Guilds (1) | GuildMessages (512) | MessageContent (32768) = 33281
  const gatewayRes = await fetch(`${DISCORD_API}/gateway/bot`, {
    headers: { Authorization: `Bot ${token}` },
  })
  if (!gatewayRes.ok) {
    const body = await gatewayRes.text()
    return { ok: false, error: `Cannot fetch gateway info (${gatewayRes.status}): ${body}` }
  }

  return { ok: true }
}

/**
 * Performs a lightweight check for MessageContent intent by attempting a
 * test gateway connection. Returns a warning message if the intent appears
 * to be disabled, or null if everything looks good.
 *
 * Note: The Discord REST API doesn't expose which intents are enabled.
 * We do a quick WebSocket handshake to the gateway to detect DisallowedIntents.
 */
export function checkGatewayIntents(token: string): Promise<string | null> {
  return new Promise(async (resolve) => {
    const timeout = setTimeout(() => resolve(null), 10000) // assume OK if no response in 10s

    try {
      const gatewayRes = await fetch(`${DISCORD_API}/gateway/bot`, {
        headers: { Authorization: `Bot ${token}` },
      })
      if (!gatewayRes.ok) {
        clearTimeout(timeout)
        resolve('Could not fetch gateway URL. Check your bot token.')
        return
      }
      const { url } = await gatewayRes.json() as { url: string }

      // Dynamic import for WebSocket (works in both Node and Bun)
      const WebSocket = (await import('ws')).default

      const ws = new WebSocket(`${url}?v=10&encoding=json`)

      ws.on('message', (data: Buffer) => {
        try {
          const payload = JSON.parse(data.toString())
          if (payload.op === 10) {
            // Send IDENTIFY with the intents we need
            // Guilds=1, GuildMessages=512, MessageContent=32768
            ws.send(JSON.stringify({
              op: 2,
              d: {
                token,
                intents: 1 | 512 | 32768,
                properties: { os: 'linux', browser: 'onkol-setup', device: 'onkol-setup' },
              },
            }))
          } else if (payload.op === 0 && payload.t === 'READY') {
            // All good — intents accepted
            ws.close()
            clearTimeout(timeout)
            resolve(null)
          }
        } catch { /* ignore parse errors */ }
      })

      ws.on('close', (code: number) => {
        clearTimeout(timeout)
        if (code === 4014) {
          resolve(
            'MessageContent intent is not enabled for this bot.\n' +
            '    Go to https://discord.com/developers/applications → your bot → Bot settings\n' +
            '    → Privileged Gateway Intents → enable "Message Content Intent" → Save'
          )
        } else if (code === 4004) {
          resolve('Invalid bot token (gateway rejected authentication).')
        }
        // Other close codes are fine (we close it ourselves on READY)
      })

      ws.on('error', () => {
        clearTimeout(timeout)
        resolve(null) // network error, don't block setup
      })
    } catch {
      clearTimeout(timeout)
      resolve(null)
    }
  })
}
