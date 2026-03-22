import { Client, GatewayIntentBits, type Message } from 'discord.js'

export interface DiscordClientConfig {
  botToken: string
  channelId: string
  allowedUsers: string[]
}

export function shouldForwardMessage(
  messageChannelId: string,
  authorId: string,
  isBot: boolean,
  targetChannelId: string,
  allowedUsers: string[]
): boolean {
  if (isBot) return false
  if (messageChannelId !== targetChannelId) return false
  if (allowedUsers.length > 0 && !allowedUsers.includes(authorId)) return false
  return true
}

export function createDiscordClient(
  config: DiscordClientConfig,
  onMessage: (message: Message) => void
) {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  })

  client.on('messageCreate', (message) => {
    if (
      shouldForwardMessage(
        message.channel.id,
        message.author.id,
        message.author.bot,
        config.channelId,
        config.allowedUsers
      )
    ) {
      onMessage(message)
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
