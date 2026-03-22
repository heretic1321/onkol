#!/usr/bin/env bun
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { execSync } from 'child_process'
import { createMcpServer } from './mcp-server.js'
import { createDiscordClient } from './discord-client.js'
import { MessageBatcher } from './message-batcher.js'

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID
const ALLOWED_USERS: string[] = JSON.parse(process.env.DISCORD_ALLOWED_USERS || '[]')
const TMUX_TARGET = process.env.TMUX_TARGET || ''

if (!BOT_TOKEN) {
  console.error('[discord-filtered] DISCORD_BOT_TOKEN is required')
  process.exit(1)
}
if (!CHANNEL_ID) {
  console.error('[discord-filtered] DISCORD_CHANNEL_ID is required')
  process.exit(1)
}

function sendInterrupt(): boolean {
  if (!TMUX_TARGET) {
    console.error('[discord-filtered] !stop received but TMUX_TARGET not set — cannot interrupt')
    return false
  }
  try {
    // Escape is Claude Code's interrupt key
    execSync(`tmux send-keys -t ${JSON.stringify(TMUX_TARGET)} Escape`, { stdio: 'pipe' })
    console.error(`[discord-filtered] Sent interrupt (Escape) to ${TMUX_TARGET}`)
    return true
  } catch (err) {
    console.error(`[discord-filtered] Failed to send interrupt: ${err}`)
    return false
  }
}

const discord = createDiscordClient(
  { botToken: BOT_TOKEN, channelId: CHANNEL_ID, allowedUsers: ALLOWED_USERS },
  async (content, message) => {
    // Instant acknowledgment — user knows the message reached the session
    try { await message.react('👀') } catch { /* ignore */ }

    const isInterrupt = /^!stop\b/i.test(content)

    if (isInterrupt) {
      sendInterrupt()
      // Strip the !stop prefix and forward the rest as a normal message
      const rest = content.replace(/^!stop\s*/i, '').trim()
      // React to confirm the interrupt was received
      try { await message.react('🛑') } catch { /* ignore */ }
      // Small delay to let Claude Code process the Escape before the new message arrives
      await new Promise(r => setTimeout(r, 1500))
      // Forward the message (with or without remaining text)
      await mcpServer.notification({
        method: 'notifications/claude/channel',
        params: {
          content: rest || '[interrupted by user]',
          meta: {
            channel_id: message.channel.id,
            sender: message.author.username,
            sender_id: message.author.id,
            message_id: message.id,
            interrupt: true,
          },
        },
      })
      return
    }

    await mcpServer.notification({
      method: 'notifications/claude/channel',
      params: {
        content: content,
        meta: {
          channel_id: message.channel.id,
          sender: message.author.username,
          sender_id: message.author.id,
          message_id: message.id,
        },
      },
    })
  }
)

const batcher = new MessageBatcher(async (text) => {
  await discord.sendMessage(CHANNEL_ID, text)
})

const mcpServer = createMcpServer({
  async reply(_channelId: string, text: string) {
    batcher.enqueue(text)
  },
  async replyWithFile(_channelId: string, text: string, filePath: string) {
    await discord.sendMessageWithFile(CHANNEL_ID, text, filePath)
  },
})

async function main() {
  await mcpServer.connect(new StdioServerTransport())
  await discord.login()
  console.error(`[discord-filtered] Ready. Listening to channel ${CHANNEL_ID}`)
}

main().catch((err) => {
  console.error('[discord-filtered] Fatal error:', err)
  process.exit(1)
})
