import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'

export interface McpToolHandlers {
  reply: (channelId: string, text: string) => Promise<void>
  replyWithFile: (channelId: string, text: string, filePath: string) => Promise<void>
}

export function createMcpServer(handlers?: McpToolHandlers) {
  const server = new Server(
    { name: 'discord-filtered', version: '0.1.0' },
    {
      capabilities: {
        experimental: { 'claude/channel': {} },
        tools: {},
      },
      instructions:
        'Messages arrive as <channel source="discord-filtered">. Reply using the reply tool. Use reply_with_file to attach files.',
    }
  )

  const channelId = process.env.DISCORD_CHANNEL_ID || ''

  const tools = [
    {
      name: 'reply',
      description: 'Send a text message back to the Discord channel',
      inputSchema: {
        type: 'object' as const,
        properties: {
          text: { type: 'string', description: 'The message text to send' },
        },
        required: ['text'],
      },
    },
    {
      name: 'reply_with_file',
      description: 'Send a text message with a file attachment to the Discord channel',
      inputSchema: {
        type: 'object' as const,
        properties: {
          text: { type: 'string', description: 'The message text to send' },
          file_path: { type: 'string', description: 'Absolute path to the file to attach' },
        },
        required: ['text', 'file_path'],
      },
    },
  ]

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools,
  }))

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params
    if (name === 'reply' && handlers) {
      await handlers.reply(channelId, (args as any).text)
      return { content: [{ type: 'text' as const, text: 'sent' }] }
    }
    if (name === 'reply_with_file' && handlers) {
      await handlers.replyWithFile(channelId, (args as any).text, (args as any).file_path)
      return { content: [{ type: 'text' as const, text: 'sent' }] }
    }
    return { content: [{ type: 'text' as const, text: `unknown tool: ${name}` }] }
  })

  // Expose listTools for testing
  ;(server as any).listTools = async () => {
    const handler = (server as any)._requestHandlers.get('tools/list')
    if (!handler) return []
    const result = await handler({ method: 'tools/list', params: {} }, {})
    return result?.tools || []
  }

  return server
}
