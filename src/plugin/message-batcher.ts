const DISCORD_MAX_LENGTH = 2000

export class MessageBatcher {
  private buffer: string[] = []
  private timer: ReturnType<typeof setTimeout> | null = null
  private sendFn: (text: string) => Promise<void>
  private delayMs: number

  constructor(sendFn: (text: string) => Promise<void>, delayMs = 3000) {
    this.sendFn = sendFn
    this.delayMs = delayMs
  }

  enqueue(text: string): void {
    this.buffer.push(text)
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), this.delayMs)
  }

  private async flush(): Promise<void> {
    if (this.buffer.length === 0) return
    const combined = this.buffer.join('\n')
    this.buffer = []
    this.timer = null

    // Split into multiple messages instead of truncating
    const chunks = splitMessage(combined)
    for (const chunk of chunks) {
      await this.sendFn(chunk)
    }
  }
}

// Split long text into Discord-safe chunks, preferring line breaks as split points
function splitMessage(text: string): string[] {
  if (text.length <= DISCORD_MAX_LENGTH) return [text]

  const chunks: string[] = []
  let remaining = text

  while (remaining.length > 0) {
    if (remaining.length <= DISCORD_MAX_LENGTH) {
      chunks.push(remaining)
      break
    }

    // Find a good split point: prefer double newline, then single newline, then space
    let splitAt = -1
    const searchWindow = remaining.slice(0, DISCORD_MAX_LENGTH)

    // Try splitting at last paragraph break
    const lastParagraph = searchWindow.lastIndexOf('\n\n')
    if (lastParagraph > DISCORD_MAX_LENGTH * 0.3) {
      splitAt = lastParagraph
    }

    // Fall back to last line break
    if (splitAt === -1) {
      const lastNewline = searchWindow.lastIndexOf('\n')
      if (lastNewline > DISCORD_MAX_LENGTH * 0.3) {
        splitAt = lastNewline
      }
    }

    // Fall back to last space
    if (splitAt === -1) {
      const lastSpace = searchWindow.lastIndexOf(' ')
      if (lastSpace > DISCORD_MAX_LENGTH * 0.3) {
        splitAt = lastSpace
      }
    }

    // Hard split as last resort
    if (splitAt === -1) {
      splitAt = DISCORD_MAX_LENGTH
    }

    chunks.push(remaining.slice(0, splitAt))
    remaining = remaining.slice(splitAt).replace(/^\n+/, '')
  }

  return chunks
}
