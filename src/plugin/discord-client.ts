import { Client, GatewayIntentBits, type Message, type Attachment } from 'discord.js'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const ATTACHMENT_DIR = join(tmpdir(), 'onkol-attachments')
mkdirSync(ATTACHMENT_DIR, { recursive: true })

// Small text files get inlined into the message content
const INLINE_MAX_BYTES = 10_000
const INLINE_CONTENT_TYPES = ['text/', 'application/json', 'application/xml', 'application/csv']

export interface DiscordClientConfig {
  botToken: string
  channelId: string
  allowedUsers: string[]
  nodeName: string
}

// Parse the [node-name] prefix from a message. Returns { nodeName, content } or null if no prefix.
export function parseNodePrefix(content: unknown): { nodeName: string; content: string } | null {
  if (typeof content !== 'string') return null
  const match = content.match(/^\[([a-zA-Z0-9_-]+)\]\s*/)
  if (!match) return null
  return { nodeName: match[1], content: content.slice(match[0].length) }
}

export function shouldForwardMessage(
  messageChannelId: string,
  authorId: string,
  isBot: boolean,
  targetChannelId: string,
  allowedUsers: string[],
  botUserId: string | null = null,
  nodeName = '',
  messageContent = ''
): boolean {
  if (messageChannelId !== targetChannelId) return false

  if (isBot) {
    // Only accept messages from our own bot (same token), not random bots
    if (!botUserId || authorId !== botUserId) return false
    // Parse the node prefix to prevent self-loops
    const parsed = parseNodePrefix(messageContent)
    if (!parsed) return false // No prefix = unknown source, ignore
    if (parsed.nodeName === nodeName) return false // Self-loop prevention
    return true
  }

  // Human messages: existing ALLOWED_USERS logic
  if (allowedUsers.length > 0 && !allowedUsers.includes(authorId)) return false
  return true
}

function shouldInline(a: Attachment): boolean {
  if (a.name?.endsWith('.txt') || a.name?.endsWith('.csv') || a.name?.endsWith('.json') || a.name?.endsWith('.md')) {
    return (a.size || 0) <= INLINE_MAX_BYTES
  }
  const ct = a.contentType || ''
  return INLINE_CONTENT_TYPES.some(t => ct.startsWith(t)) && (a.size || 0) <= INLINE_MAX_BYTES
}

// Download all attachments: small text gets inlined, everything else saved to disk.
// Claude Code's Read tool handles images, PDFs, CSVs, notebooks, etc. natively.
async function resolveAttachments(message: Message): Promise<string> {
  let content = message.content

  for (const attachment of message.attachments.values()) {
    try {
      const res = await fetch(attachment.url)
      if (!res.ok) continue

      if (shouldInline(attachment)) {
        // Inline small text files directly into the message
        const text = await res.text()
        const label = attachment.name ? `[${attachment.name}]` : ''
        content = content ? `${content}\n\n${label}\n${text}` : `${label}\n${text}`
      } else {
        // Save to disk — Claude Code can Read images, PDFs, CSVs, etc.
        const buffer = Buffer.from(await res.arrayBuffer())
        const filename = `${message.id}-${attachment.name || 'file'}`
        const filepath = join(ATTACHMENT_DIR, filename)
        writeFileSync(filepath, buffer)
        const note = `[User sent a file: ${attachment.name || 'file'} (${formatSize(buffer.length)}). Saved to ${filepath} — use the Read tool to view it.]`
        content = content ? `${content}\n\n${note}` : note
        console.error(`[discord-filtered] Downloaded: ${filepath} (${formatSize(buffer.length)})`)
      }
    } catch (err) {
      console.error(`[discord-filtered] Failed to fetch attachment ${attachment.name}: ${err}`)
    }
  }

  return content
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

export function createDiscordClient(
  config: DiscordClientConfig,
  onMessage: (content: string, message: Message) => void
) {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  })

  client.on('messageCreate', async (message) => {
    const botUserId = client.user?.id || null
    if (
      shouldForwardMessage(
        message.channel.id,
        message.author.id,
        message.author.bot,
        config.channelId,
        config.allowedUsers,
        botUserId,
        config.nodeName,
        message.content
      )
    ) {
      let content = await resolveAttachments(message)
      // Strip the [node-name] prefix from bot messages before forwarding
      if (message.author.bot && content) {
        const parsed = parseNodePrefix(content)
        if (parsed) content = parsed.content
      }
      if (content) {
        onMessage(content, message)
      }
    }
  })

  client.on('ready', () => {
    console.error(`[discord-filtered] Connected as ${client.user?.tag}, filtering to channel ${config.channelId}`)
  })

  return {
    login: () => client.login(config.botToken),
    client,
    async sendMessage(channelId: string, text: string) {
      const channel = await client.channels.fetch(channelId)
      if (channel?.isTextBased() && 'send' in channel) {
        await channel.send(text)
      }
    },
    async sendMessageWithFile(channelId: string, text: string, filePath: string) {
      const channel = await client.channels.fetch(channelId)
      if (channel?.isTextBased() && 'send' in channel) {
        await channel.send({ content: text, files: [{ attachment: filePath }] })
      }
    },
  }
}
