#!/usr/bin/env bun
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createMcpServer } from './mcp-server.js'
import { createDiscordClient } from './discord-client.js'
import { MessageBatcher } from './message-batcher.js'

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID
const ALLOWED_USERS: string[] = JSON.parse(process.env.DISCORD_ALLOWED_USERS || '[]')

if (!BOT_TOKEN) {
  console.error('[discord-filtered] DISCORD_BOT_TOKEN is required')
  process.exit(1)
}
if (!CHANNEL_ID) {
  console.error('[discord-filtered] DISCORD_CHANNEL_ID is required')
  process.exit(1)
}

const discord = createDiscordClient(
  { botToken: BOT_TOKEN, channelId: CHANNEL_ID, allowedUsers: ALLOWED_USERS },
  async (message) => {
    await mcpServer.notification({
      method: 'notifications/claude/channel',
      params: {
        content: message.content,
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
