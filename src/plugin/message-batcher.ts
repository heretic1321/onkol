const DISCORD_MAX_LENGTH = 2000
const TRUNCATION_SUFFIX = '\n... (truncated)'

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
    let combined = this.buffer.join('\n')
    this.buffer = []
    this.timer = null

    if (combined.length > DISCORD_MAX_LENGTH) {
      combined = combined.slice(0, DISCORD_MAX_LENGTH - TRUNCATION_SUFFIX.length) + TRUNCATION_SUFFIX
    }

    await this.sendFn(combined)
  }
}
