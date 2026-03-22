# Onkol Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a decentralized on-call agent system where each VM runs a Claude Code orchestrator connected to Discord, capable of spawning worker sessions per task.

**Architecture:** An npm package (`onkol`) provides a setup wizard CLI and a custom MCP channel plugin. Bash scripts handle worker lifecycle (spawn/dissolve). The orchestrator and workers are Claude Code sessions guided by generated CLAUDE.md files, communicating via Discord Channels.

**Tech Stack:** Bun (MCP plugin), Node.js/TypeScript (setup wizard CLI), Bash (lifecycle scripts), Discord.js (gateway + API), MCP SDK (`@modelcontextprotocol/sdk`)

**Spec:** `docs/superpowers/specs/2026-03-22-onkol-design.md`

---

## Review Findings (MUST READ BEFORE EXECUTING)

The following issues were found during plan review. Agents executing this plan MUST apply these fixes during the relevant tasks:

### Critical Fixes

1. **Plugin needs its own `package.json`** — Task 5 must create a `package.json` in `src/plugin/` (and the setup wizard must copy it + run `bun install` in `plugins/discord-filtered/` on the target VM). Without this, the plugin can't resolve `discord.js` or `@modelcontextprotocol/sdk` at runtime.

2. **`__dirname` undefined in `src/cli/index.ts`** — Task 10 must add this at the top of `index.ts`:
   ```typescript
   import { dirname } from 'path'
   import { fileURLToPath } from 'url'
   const __dirname = dirname(fileURLToPath(import.meta.url))
   ```

3. **`.mcp.json` DISCORD_ALLOWED_USERS must be a string** — In `spawn-worker.sh` (Task 9), the `.mcp.json` heredoc must wrap the allowed users value in quotes since env vars are strings:
   ```bash
   "DISCORD_ALLOWED_USERS": "$(echo "$ALLOWED_USERS" | sed 's/"/\\"/g')"
   ```

4. **Heredoc injection risk in bash scripts** — Task 9: `task.md` and `context.md` content comes from user input via orchestrator. Use `printf '%s'` to write these files instead of unquoted heredocs to prevent shell injection.

### Important Fixes

5. **Remove dead template code** — `templates/worker-claude.md.hbs` and `templates/worker-mcp.json.hbs` are never used (spawn-worker.sh generates everything inline). Remove them from the file map and Task 8 to avoid confusion. Keep only `orchestrator-claude.md.hbs` and `settings.json.hbs`.

6. **Per-worker `bash-log.txt`** — The `PostToolUse` hook in worker settings must point to the worker's own directory, not a global file. The spawn script must generate a per-worker `.claude/settings.json` with the correct path.

7. **Add Discord user ID prompt to setup** — Task 10: the setup wizard should ask for at least one Discord user ID to add to `allowedUsers`. An empty allowlist means anyone can message the bot, which is a security gap.

8. **Settings.json hook format** — The hooks use nested `[{ "hooks": [...] }]` structure which is correct per Claude Code settings schema. The `PostToolUse` `jq` command reads from stdin which is correct for hooks.

---

## File Map

```
onkol/
├── package.json                          # npm package, bin: "onkol"
├── tsconfig.json                         # TypeScript config
├── .gitignore
├── src/
│   ├── cli/
│   │   ├── index.ts                      # CLI entry point (npx onkol setup)
│   │   ├── prompts.ts                    # Interactive prompt questions
│   │   ├── discord-api.ts                # Discord REST API helpers (create category, channel, etc.)
│   │   ├── auto-discover.ts              # Service auto-discovery (docker, pm2, systemd, ss)
│   │   ├── templates.ts                  # CLAUDE.md and config file generators
│   │   └── systemd.ts                    # Systemd service file generator
│   └── plugin/
│       ├── index.ts                      # discord-filtered MCP channel plugin entry
│       ├── discord-client.ts             # Discord gateway connection + message filtering
│       ├── mcp-server.ts                 # MCP server setup (channel capability, tools)
│       └── message-batcher.ts            # Outgoing message batching (3-second buffer)
├── scripts/
│   ├── spawn-worker.sh                   # Creates Discord channel, worker dir, starts CC
│   ├── dissolve-worker.sh                # Captures learnings, kills session, cleans up
│   ├── list-workers.sh                   # Shows active workers from tracking.json
│   ├── check-worker.sh                   # Reads a worker's status.json
│   ├── healthcheck.sh                    # Cron-based worker health monitor
│   └── start-orchestrator.sh             # Wrapper for systemd to start orchestrator in tmux
├── templates/
│   ├── orchestrator-claude.md.hbs        # Handlebars template for orchestrator CLAUDE.md
│   ├── worker-claude.md.hbs              # Handlebars template for worker CLAUDE.md
│   ├── worker-mcp.json.hbs              # Template for worker .mcp.json
│   └── settings.json.hbs                # Template for .claude/settings.json (hooks)
├── test/
│   ├── plugin/
│   │   ├── mcp-server.test.ts            # MCP server unit tests
│   │   ├── discord-client.test.ts        # Discord client filtering tests
│   │   └── message-batcher.test.ts       # Message batching tests
│   ├── cli/
│   │   ├── discord-api.test.ts           # Discord REST API helper tests
│   │   ├── auto-discover.test.ts         # Service discovery tests
│   │   └── templates.test.ts             # Template generation tests
│   └── scripts/
│       ├── spawn-worker.test.sh          # Spawn script tests (with mocks)
│       └── dissolve-worker.test.sh       # Dissolve script tests (with mocks)
└── docs/
    └── superpowers/
        ├── specs/
        │   └── 2026-03-22-onkol-design.md
        └── plans/
            └── 2026-03-22-onkol-implementation.md
```

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `src/cli/index.ts` (stub)
- Create: `src/plugin/index.ts` (stub)

- [ ] **Step 1: Initialize npm package**

```bash
cd /home/heretic/Documents/projects/onkol
```

Create `package.json`:
```json
{
  "name": "onkol",
  "version": "0.1.0",
  "description": "Decentralized on-call agent system powered by Claude Code",
  "type": "module",
  "bin": {
    "onkol": "./dist/cli/index.js"
  },
  "scripts": {
    "build": "tsc",
    "test": "bun test",
    "test:scripts": "bash test/scripts/run-all.sh",
    "dev:plugin": "bun run src/plugin/index.ts"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "discord.js": "^14.0.0",
    "handlebars": "^4.7.0",
    "inquirer": "^12.0.0",
    "chalk": "^5.0.0",
    "commander": "^13.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.7.0",
    "bun-types": "^1.2.0"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "test"]
}
```

- [ ] **Step 3: Create .gitignore**

```
node_modules/
dist/
*.env
.DS_Store
```

- [ ] **Step 4: Create stub entry points**

`src/cli/index.ts`:
```typescript
#!/usr/bin/env node
console.log('onkol setup - not yet implemented')
```

`src/plugin/index.ts`:
```typescript
#!/usr/bin/env bun
console.log('discord-filtered plugin - not yet implemented')
```

- [ ] **Step 5: Install dependencies and verify build**

```bash
npm install
npx tsc --noEmit
```

Expected: clean install, no type errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: project scaffolding with package.json, tsconfig, stubs"
```

---

### Task 2: Message Batcher

**Files:**
- Create: `src/plugin/message-batcher.ts`
- Create: `test/plugin/message-batcher.test.ts`

The simplest independent unit. Buffer outgoing Discord messages for 3 seconds, combine rapid sequential sends into one message.

- [ ] **Step 1: Write the failing test**

`test/plugin/message-batcher.test.ts`:
```typescript
import { describe, it, expect, beforeEach, jest } from 'bun:test'
import { MessageBatcher } from '../../src/plugin/message-batcher'

describe('MessageBatcher', () => {
  let batcher: MessageBatcher
  let sent: string[]

  beforeEach(() => {
    sent = []
    batcher = new MessageBatcher(async (text: string) => {
      sent.push(text)
    }, 50) // 50ms buffer for tests (3000ms in prod)
  })

  it('sends a single message after buffer delay', async () => {
    batcher.enqueue('hello')
    expect(sent).toHaveLength(0)
    await new Promise(r => setTimeout(r, 100))
    expect(sent).toHaveLength(1)
    expect(sent[0]).toBe('hello')
  })

  it('combines rapid messages into one', async () => {
    batcher.enqueue('line 1')
    batcher.enqueue('line 2')
    batcher.enqueue('line 3')
    await new Promise(r => setTimeout(r, 100))
    expect(sent).toHaveLength(1)
    expect(sent[0]).toBe('line 1\nline 2\nline 3')
  })

  it('sends separately if gap exceeds buffer time', async () => {
    batcher.enqueue('first')
    await new Promise(r => setTimeout(r, 100))
    batcher.enqueue('second')
    await new Promise(r => setTimeout(r, 100))
    expect(sent).toHaveLength(2)
    expect(sent[0]).toBe('first')
    expect(sent[1]).toBe('second')
  })

  it('truncates messages over 2000 chars (Discord limit)', async () => {
    const long = 'x'.repeat(2500)
    batcher.enqueue(long)
    await new Promise(r => setTimeout(r, 100))
    expect(sent[0].length).toBeLessThanOrEqual(2000)
    expect(sent[0]).toContain('... (truncated)')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test test/plugin/message-batcher.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement MessageBatcher**

`src/plugin/message-batcher.ts`:
```typescript
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test test/plugin/message-batcher.test.ts
```

Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/plugin/message-batcher.ts test/plugin/message-batcher.test.ts
git commit -m "feat: message batcher with 3-second buffering and Discord truncation"
```

---

### Task 3: MCP Server (Channel Protocol)

**Files:**
- Create: `src/plugin/mcp-server.ts`
- Create: `test/plugin/mcp-server.test.ts`

The MCP server declares `claude/channel` capability and exposes `reply` + `reply_with_file` tools. Tested independently of Discord.

- [ ] **Step 1: Write the failing test**

`test/plugin/mcp-server.test.ts`:
```typescript
import { describe, it, expect } from 'bun:test'
import { createMcpServer } from '../../src/plugin/mcp-server'

describe('createMcpServer', () => {
  it('creates server with claude/channel capability', () => {
    const server = createMcpServer()
    expect(server).toBeDefined()
    // Server should have been created without errors
  })

  it('declares reply and reply_with_file tools', async () => {
    const server = createMcpServer()
    // Access the registered tool handlers via server internals
    // The tool list is verified by calling the ListTools handler
    const tools = await server.listTools()
    const toolNames = tools.map((t: any) => t.name)
    expect(toolNames).toContain('reply')
    expect(toolNames).toContain('reply_with_file')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test test/plugin/mcp-server.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement MCP server**

`src/plugin/mcp-server.ts`:
```typescript
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

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
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
    ],
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
    const result = await (server as any)._requestHandlers.get(ListToolsRequestSchema.method)?.({
      method: ListToolsRequestSchema.method,
      params: {},
    })
    return result?.tools || []
  }

  return server
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test test/plugin/mcp-server.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/plugin/mcp-server.ts test/plugin/mcp-server.test.ts
git commit -m "feat: MCP server with claude/channel capability and reply tools"
```

---

### Task 4: Discord Client (Filtered Gateway Connection)

**Files:**
- Create: `src/plugin/discord-client.ts`
- Create: `test/plugin/discord-client.test.ts`

Connects to Discord, filters messages by channel ID and sender allowlist, emits events for the MCP server to forward.

- [ ] **Step 1: Write the failing test**

`test/plugin/discord-client.test.ts`:
```typescript
import { describe, it, expect } from 'bun:test'
import { shouldForwardMessage } from '../../src/plugin/discord-client'

describe('shouldForwardMessage', () => {
  const channelId = '123456'
  const allowedUsers = ['user1', 'user2']

  it('forwards messages from correct channel and allowed user', () => {
    expect(shouldForwardMessage('123456', 'user1', false, channelId, allowedUsers)).toBe(true)
  })

  it('rejects messages from wrong channel', () => {
    expect(shouldForwardMessage('999999', 'user1', false, channelId, allowedUsers)).toBe(false)
  })

  it('rejects messages from disallowed user', () => {
    expect(shouldForwardMessage('123456', 'user3', false, channelId, allowedUsers)).toBe(false)
  })

  it('rejects bot messages', () => {
    expect(shouldForwardMessage('123456', 'user1', true, channelId, allowedUsers)).toBe(false)
  })

  it('allows any user when allowlist is empty', () => {
    expect(shouldForwardMessage('123456', 'anyone', false, channelId, [])).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test test/plugin/discord-client.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement Discord client**

`src/plugin/discord-client.ts`:
```typescript
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test test/plugin/discord-client.test.ts
```

Expected: PASS (only the pure `shouldForwardMessage` function is tested; the client itself requires a real Discord connection).

- [ ] **Step 5: Commit**

```bash
git add src/plugin/discord-client.ts test/plugin/discord-client.test.ts
git commit -m "feat: Discord client with channel ID filtering and sender allowlist"
```

---

### Task 5: Plugin Entry Point (Wire Everything Together)

**Files:**
- Modify: `src/plugin/index.ts`

Wires the MCP server, Discord client, and message batcher into the complete plugin.

- [ ] **Step 1: Implement the plugin entry point**

`src/plugin/index.ts`:
```typescript
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
```

- [ ] **Step 2: Verify it compiles**

```bash
cd /home/heretic/Documents/projects/onkol && npx tsc --noEmit
```

Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add src/plugin/index.ts
git commit -m "feat: discord-filtered plugin entry point wiring MCP + Discord + batcher"
```

---

### Task 6: Discord REST API Helpers (for CLI and Scripts)

**Files:**
- Create: `src/cli/discord-api.ts`
- Create: `test/cli/discord-api.test.ts`

Pure functions that wrap Discord REST API calls. Used by both the setup wizard and bash scripts (via a small CLI wrapper).

- [ ] **Step 1: Write the failing test**

`test/cli/discord-api.test.ts`:
```typescript
import { describe, it, expect } from 'bun:test'
import { buildCreateCategoryPayload, buildCreateChannelPayload } from '../../src/cli/discord-api'

describe('Discord API payload builders', () => {
  it('builds category creation payload', () => {
    const payload = buildCreateCategoryPayload('loyalty-voicebot')
    expect(payload).toEqual({
      name: 'loyalty-voicebot',
      type: 4, // GUILD_CATEGORY
    })
  })

  it('builds channel creation payload under a category', () => {
    const payload = buildCreateChannelPayload('fix-auth', '999')
    expect(payload).toEqual({
      name: 'fix-auth',
      type: 0, // GUILD_TEXT
      parent_id: '999',
    })
  })

  it('sanitizes channel names (lowercase, hyphens)', () => {
    const payload = buildCreateChannelPayload('Fix Auth Bug!', '999')
    expect(payload.name).toBe('fix-auth-bug')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test test/cli/discord-api.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement Discord API helpers**

`src/cli/discord-api.ts`:
```typescript
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
  return { name, type: 4 } // GUILD_CATEGORY
}

export function buildCreateChannelPayload(name: string, parentId: string) {
  return { name: sanitizeChannelName(name), type: 0, parent_id: parentId } // GUILD_TEXT
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test test/cli/discord-api.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/discord-api.ts test/cli/discord-api.test.ts
git commit -m "feat: Discord REST API helpers for category/channel CRUD"
```

---

### Task 7: Service Auto-Discovery

**Files:**
- Create: `src/cli/auto-discover.ts`
- Create: `test/cli/auto-discover.test.ts`

Discovers running services on the VM by parsing output from docker, pm2, systemd, and ss.

- [ ] **Step 1: Write the failing test**

`test/cli/auto-discover.test.ts`:
```typescript
import { describe, it, expect } from 'bun:test'
import { parseDockerPs, parseSsOutput } from '../../src/cli/auto-discover'

describe('parseDockerPs', () => {
  it('parses docker ps output', () => {
    const output = `CONTAINER ID   IMAGE          PORTS                    NAMES
abc123         loyalty:v2     0.0.0.0:8080->8080/tcp   loyalty-bot
def456         postgres:15    0.0.0.0:5432->5432/tcp   postgres`

    const services = parseDockerPs(output)
    expect(services).toHaveLength(2)
    expect(services[0]).toEqual({ name: 'loyalty-bot', type: 'docker', port: '8080', image: 'loyalty:v2' })
    expect(services[1]).toEqual({ name: 'postgres', type: 'docker', port: '5432', image: 'postgres:15' })
  })

  it('returns empty array for no containers', () => {
    expect(parseDockerPs('CONTAINER ID   IMAGE   PORTS   NAMES\n')).toEqual([])
  })
})

describe('parseSsOutput', () => {
  it('parses ss listening ports', () => {
    const output = `State  Recv-Q Send-Q Local Address:Port  Peer Address:Port Process
LISTEN 0      128          *:3000           *:*     users:(("node",pid=1234,fd=5))
LISTEN 0      128          *:80             *:*     users:(("nginx",pid=5678,fd=6))`

    const services = parseSsOutput(output)
    expect(services).toHaveLength(2)
    expect(services[0]).toEqual({ name: 'node', type: 'process', port: '3000' })
    expect(services[1]).toEqual({ name: 'nginx', type: 'process', port: '80' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test test/cli/auto-discover.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement auto-discovery parsers**

`src/cli/auto-discover.ts`:
```typescript
import { execSync } from 'child_process'

export interface DiscoveredService {
  name: string
  type: 'docker' | 'pm2' | 'systemd' | 'process'
  port?: string
  image?: string
  status?: string
}

export function parseDockerPs(output: string): DiscoveredService[] {
  const lines = output.trim().split('\n').slice(1) // skip header
  return lines
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const parts = line.split(/\s{2,}/)
      const name = parts[parts.length - 1]?.trim()
      const image = parts[1]?.trim()
      const portsField = parts.find((p) => p.includes('->')) || ''
      const portMatch = portsField.match(/:(\d+)->/)
      return { name, type: 'docker' as const, port: portMatch?.[1], image }
    })
    .filter((s) => s.name)
}

export function parseSsOutput(output: string): DiscoveredService[] {
  const lines = output.trim().split('\n').slice(1)
  return lines
    .filter((line) => line.includes('LISTEN'))
    .map((line) => {
      const portMatch = line.match(/\*:(\d+)/)
      const processMatch = line.match(/\("([^"]+)"/)
      return {
        name: processMatch?.[1] || 'unknown',
        type: 'process' as const,
        port: portMatch?.[1],
      }
    })
    .filter((s) => s.port)
}

export function discoverServices(): DiscoveredService[] {
  const services: DiscoveredService[] = []

  try {
    const dockerOutput = execSync('docker ps --format "table {{.ID}}\\t{{.Image}}\\t{{.Ports}}\\t{{.Names}}"', { encoding: 'utf-8', timeout: 5000 })
    services.push(...parseDockerPs(dockerOutput))
  } catch { /* docker not available */ }

  try {
    const ssOutput = execSync('ss -tlnp 2>/dev/null', { encoding: 'utf-8', timeout: 5000 })
    const processServices = parseSsOutput(ssOutput)
    // Deduplicate against docker ports
    const dockerPorts = new Set(services.map((s) => s.port))
    services.push(...processServices.filter((s) => !dockerPorts.has(s.port)))
  } catch { /* ss not available */ }

  return services
}

export function formatServicesMarkdown(services: DiscoveredService[]): string {
  if (services.length === 0) return 'No services discovered.\n'
  let md = '## Discovered Services\n\n'
  for (const s of services) {
    md += `- **${s.name}** (${s.type})`
    if (s.port) md += ` on port ${s.port}`
    if (s.image) md += ` — image: ${s.image}`
    md += '\n'
  }
  return md
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test test/cli/auto-discover.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/auto-discover.ts test/cli/auto-discover.test.ts
git commit -m "feat: service auto-discovery parsing docker ps and ss output"
```

---

### Task 8: Template Generation

**Files:**
- Create: `src/cli/templates.ts`
- Create: `templates/orchestrator-claude.md.hbs`
- Create: `templates/worker-claude.md.hbs`
- Create: `templates/worker-mcp.json.hbs`
- Create: `templates/settings.json.hbs`
- Create: `test/cli/templates.test.ts`

Generates CLAUDE.md, .mcp.json, and settings.json from templates using Handlebars.

- [ ] **Step 1: Create template files**

`templates/orchestrator-claude.md.hbs`:
```markdown
You are the Onkol orchestrator for "{{nodeName}}" on this VM.

## Your Role
You do NOT solve tasks yourself. You spawn worker Claude Code sessions.

## When a message arrives
1. Understand the task and its intent (fix, investigate, build, analyze, override)
2. Determine which project directory the task relates to
3. Prepare a task brief with relevant context from:
   - registry.json (secrets, endpoints, ports)
   - services.md (what runs where, how to access logs)
   - knowledge/ (past learnings from dissolved workers)
4. Run `./scripts/spawn-worker.sh` to create a worker
5. Report back with the Discord channel name

## Intent Detection
- "fix..." / "resolve..." / "patch..." → intent: fix (autonomous — diagnose, fix, test, commit to branch)
- "look into..." / "investigate..." / "check why..." → intent: investigate (report only — no code changes)
- "add..." / "build..." / "create..." / "implement..." → intent: build (semi-autonomous — implement, test, show diff, wait for approval)
- "just ship it" / "deploy" / "push it" → intent: override (fully autonomous — requires confirmation before deploy)
- "analyze..." / "show me..." / "report on..." → intent: analyze (read-only)

## Spawning a Worker
```bash
./scripts/spawn-worker.sh \
  --name "short-task-name" \
  --dir "/path/to/project" \
  --task "Full task description" \
  --intent "fix|investigate|build|analyze|override" \
  --context "relevant context excerpts"
```

## Monitoring Workers
- Read `workers/tracking.json` to see active workers
- Run `./scripts/check-worker.sh --name "worker-name"` to check status
- Run `./scripts/list-workers.sh` to see all workers

## Dissolving Workers
When a worker is done or you are asked to dissolve:
```bash
./scripts/dissolve-worker.sh --name "worker-name"
```

## On Startup
Read these files to understand your current state:
1. config.json — who you are
2. registry.json — VM-specific endpoints, secrets, ports
3. services.md — what runs on this VM, how to access logs
4. workers/tracking.json — any active workers
5. knowledge/index.json — past learnings (include relevant ones in worker context)
6. state.md — any pending decisions from before restart

Then post: "{{nodeName}} is online. [N] active workers."

## Health Checks
Every time you receive a message, also check:
1. Read tracking.json for active workers
2. Run `tmux list-windows -t onkol-{{nodeName}}` to verify workers are alive
3. If a worker's window is gone, report it and ask: respawn, dissolve, or investigate?

## Adaptive Communication
- Quick tasks (< 5 min): just report results
- Medium tasks (5-15 min): report at start and finish
- Long tasks (15+ min): milestone updates every 10 minutes
- If stuck: ask immediately, block until human responds

## Worker Concurrency
Maximum {{maxWorkers}} concurrent workers. If at capacity, queue the task and notify.

## Important
- You do NOT write code yourself
- You do NOT access project codebases directly
- You are a dispatcher and manager
- All your state is in files — your conversation history is ephemeral
```

`templates/worker-claude.md.hbs`:
```markdown
You are an Onkol worker session for "{{nodeName}}".

## Your Task
Read your task brief: {{taskFile}}
Read your context: {{contextFile}}

## Intent: {{intent}}
{{#if (eq intent "fix")}}
- Diagnose the issue
- Fix it
- Run tests
- Commit to a branch (not main)
- Report results in this Discord channel
{{/if}}
{{#if (eq intent "investigate")}}
- Analyze the issue
- Gather data and evidence
- Report findings in this Discord channel
- Do NOT modify any files
- Do NOT make code changes
{{/if}}
{{#if (eq intent "build")}}
- Implement the feature/change
- Write tests
- Create a branch, show diff
- Wait for approval before merging
{{/if}}
{{#if (eq intent "analyze")}}
- Read logs, data, code as needed
- Produce analysis
- Report in this Discord channel
- Do NOT modify any files
{{/if}}
{{#if (eq intent "override")}}
- Full autonomy including push and deploy
- Before deploying: ask "About to deploy. Confirm?" and wait for response
{{/if}}

## Rules
- If you get stuck, ask in this channel. A human will respond.
- Update your status periodically in {{statusFile}}:
  `{ "status": "what you're doing", "updated": "ISO timestamp" }`
- Before dissolution, write what you learned to {{learningsFile}}
  Use this format:
  ```
  ## What happened
  ## Root cause
  ## Fix
  ## For next time
  ```

## Context
{{context}}
```

`templates/worker-mcp.json.hbs`:
```json
{
  "mcpServers": {
    "discord-filtered": {
      "command": "bun",
      "args": ["{{pluginPath}}"],
      "env": {
        "DISCORD_BOT_TOKEN": "{{botToken}}",
        "DISCORD_CHANNEL_ID": "{{channelId}}",
        "DISCORD_ALLOWED_USERS": "{{allowedUsersJson}}"
      }
    }
  }
}
```

`templates/settings.json.hbs`:
```json
{
  "hooks": {
    "PreCompact": [{
      "hooks": [{
        "type": "command",
        "command": "echo '{\"systemMessage\": \"Before compacting: write any in-flight task state to workers/tracking.json and pending decisions to state.md\"}'"
      }]
    }],
    "PostToolUse": [{
      "matcher": "Bash",
      "hooks": [{
        "type": "command",
        "command": "jq -r '.tool_input.command' >> {{bashLogPath}}"
      }]
    }]
  },
  "permissions": {
    "defaultMode": "acceptEdits"
  }
}
```

- [ ] **Step 2: Write the failing test**

`test/cli/templates.test.ts`:
```typescript
import { describe, it, expect } from 'bun:test'
import { renderOrchestratorClaude, renderWorkerMcpJson } from '../../src/cli/templates'

describe('renderOrchestratorClaude', () => {
  it('renders orchestrator CLAUDE.md with node name', () => {
    const result = renderOrchestratorClaude({ nodeName: 'loyalty-voicebot', maxWorkers: 3 })
    expect(result).toContain('loyalty-voicebot')
    expect(result).toContain('You do NOT solve tasks yourself')
    expect(result).toContain('Maximum 3 concurrent workers')
  })
})

describe('renderWorkerMcpJson', () => {
  it('renders .mcp.json with channel ID', () => {
    const result = renderWorkerMcpJson({
      pluginPath: '/home/user/onkol/plugins/discord-filtered/index.ts',
      botToken: 'test-token',
      channelId: '12345',
      allowedUsersJson: '["user1"]',
    })
    const parsed = JSON.parse(result)
    expect(parsed.mcpServers['discord-filtered'].env.DISCORD_CHANNEL_ID).toBe('12345')
    expect(parsed.mcpServers['discord-filtered'].env.DISCORD_BOT_TOKEN).toBe('test-token')
  })
})
```

- [ ] **Step 3: Implement template renderer**

`src/cli/templates.ts`:
```typescript
import Handlebars from 'handlebars'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const TEMPLATES_DIR = resolve(__dirname, '../../templates')

function loadTemplate(name: string): HandlebarsTemplateDelegate {
  const content = readFileSync(resolve(TEMPLATES_DIR, name), 'utf-8')
  return Handlebars.compile(content)
}

Handlebars.registerHelper('eq', (a: string, b: string) => a === b)

export function renderOrchestratorClaude(data: { nodeName: string; maxWorkers: number }): string {
  return loadTemplate('orchestrator-claude.md.hbs')(data)
}

export function renderWorkerClaude(data: {
  nodeName: string
  intent: string
  taskFile: string
  contextFile: string
  statusFile: string
  learningsFile: string
  context: string
}): string {
  return loadTemplate('worker-claude.md.hbs')(data)
}

export function renderWorkerMcpJson(data: {
  pluginPath: string
  botToken: string
  channelId: string
  allowedUsersJson: string
}): string {
  return loadTemplate('worker-mcp.json.hbs')(data)
}

export function renderSettings(data: { bashLogPath: string }): string {
  return loadTemplate('settings.json.hbs')(data)
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test test/cli/templates.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/templates.ts templates/ test/cli/templates.test.ts
git commit -m "feat: Handlebars templates for orchestrator/worker CLAUDE.md and configs"
```

---

### Task 9: Worker Lifecycle Scripts

**Files:**
- Create: `scripts/spawn-worker.sh`
- Create: `scripts/dissolve-worker.sh`
- Create: `scripts/list-workers.sh`
- Create: `scripts/check-worker.sh`
- Create: `scripts/healthcheck.sh`
- Create: `scripts/start-orchestrator.sh`

Core bash scripts that manage the worker lifecycle. The orchestrator calls these via Bash tool.

- [ ] **Step 1: Implement spawn-worker.sh**

`scripts/spawn-worker.sh`:
```bash
#!/bin/bash
set -euo pipefail

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --name) WORKER_NAME="$2"; shift 2 ;;
    --dir) WORK_DIR="$2"; shift 2 ;;
    --task) TASK_DESC="$2"; shift 2 ;;
    --intent) INTENT="$2"; shift 2 ;;
    --context) CONTEXT="$2"; shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

# Validate required args
: "${WORKER_NAME:?--name is required}"
: "${WORK_DIR:?--dir is required}"
: "${TASK_DESC:?--task is required}"
: "${INTENT:=fix}"
: "${CONTEXT:=No additional context.}"

# Load config
ONKOL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="$ONKOL_DIR/config.json"
BOT_TOKEN=$(jq -r '.botToken' "$CONFIG")
GUILD_ID=$(jq -r '.guildId' "$CONFIG")
CATEGORY_ID=$(jq -r '.categoryId' "$CONFIG")
ALLOWED_USERS=$(jq -c '.allowedUsers' "$CONFIG")
NODE_NAME=$(jq -r '.nodeName' "$CONFIG")
MAX_WORKERS=$(jq -r '.maxWorkers // 3' "$CONFIG")
TMUX_SESSION="onkol-${NODE_NAME}"

# Check concurrency limit
TRACKING="$ONKOL_DIR/workers/tracking.json"
if [ -f "$TRACKING" ]; then
  ACTIVE_COUNT=$(jq '[.[] | select(.status == "active")] | length' "$TRACKING")
  if [ "$ACTIVE_COUNT" -ge "$MAX_WORKERS" ]; then
    echo "ERROR: Worker limit reached ($ACTIVE_COUNT/$MAX_WORKERS). Task queued."
    exit 1
  fi
fi

# Create Discord channel
CHANNEL_RESPONSE=$(curl -s -X POST \
  "https://discord.com/api/v10/guilds/${GUILD_ID}/channels" \
  -H "Authorization: Bot ${BOT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"name\": \"$(echo "$WORKER_NAME" | tr '[:upper:]' '[:lower:]' | tr ' ' '-')\", \"type\": 0, \"parent_id\": \"${CATEGORY_ID}\"}")

CHANNEL_ID=$(echo "$CHANNEL_RESPONSE" | jq -r '.id')
if [ "$CHANNEL_ID" = "null" ] || [ -z "$CHANNEL_ID" ]; then
  echo "ERROR: Failed to create Discord channel: $CHANNEL_RESPONSE"
  exit 1
fi

# Create worker directory
WORKER_DIR="$ONKOL_DIR/workers/$WORKER_NAME"
mkdir -p "$WORKER_DIR"

# Write task.md
cat > "$WORKER_DIR/task.md" << TASKEOF
# Task: $WORKER_NAME

**Intent:** $INTENT
**Working directory:** $WORK_DIR
**Created:** $(date -Iseconds)

## Description
$TASK_DESC
TASKEOF

# Write context.md
cat > "$WORKER_DIR/context.md" << CTXEOF
# Context for $WORKER_NAME

$CONTEXT
CTXEOF

# Write .mcp.json
PLUGIN_PATH="$ONKOL_DIR/plugins/discord-filtered/index.ts"
cat > "$WORKER_DIR/.mcp.json" << MCPEOF
{
  "mcpServers": {
    "discord-filtered": {
      "command": "bun",
      "args": ["$PLUGIN_PATH"],
      "env": {
        "DISCORD_BOT_TOKEN": "$BOT_TOKEN",
        "DISCORD_CHANNEL_ID": "$CHANNEL_ID",
        "DISCORD_ALLOWED_USERS": $(echo "$ALLOWED_USERS")
      }
    }
  }
}
MCPEOF

# Write worker CLAUDE.md
cat > "$WORKER_DIR/CLAUDE.md" << CLEOF
You are an Onkol worker session for "$NODE_NAME".

## Your Task
Read your task brief: $WORKER_DIR/task.md
Read your context: $WORKER_DIR/context.md

## Intent: $INTENT
$(case $INTENT in
  fix) echo "- Diagnose the issue, fix it, run tests, commit to a branch (not main), report results" ;;
  investigate) echo "- Analyze the issue, gather data, report findings. Do NOT modify any files." ;;
  build) echo "- Implement the feature, write tests, create a branch, show diff, wait for approval" ;;
  analyze) echo "- Read logs/data/code, produce analysis, report. Do NOT modify any files." ;;
  override) echo "- Full autonomy including push and deploy. Before deploying: ask 'About to deploy. Confirm?' and wait." ;;
esac)

## Rules
- If you get stuck, ask in this channel. A human will respond.
- Update your status in $WORKER_DIR/status.json periodically
- Before dissolution, write learnings to $WORKER_DIR/learnings.md
CLEOF

# Write initial status.json
cat > "$WORKER_DIR/status.json" << STATUSEOF
{
  "status": "starting",
  "updated": "$(date -Iseconds)",
  "task": "$WORKER_NAME",
  "intent": "$INTENT"
}
STATUSEOF

# Determine allowed tools based on intent
case $INTENT in
  fix|build|override) ALLOWED_TOOLS="Bash,Read,Edit,Write,Glob,Grep" ;;
  investigate|analyze) ALLOWED_TOOLS="Bash,Read,Glob,Grep" ;;
  *) ALLOWED_TOOLS="Bash,Read,Edit,Write,Glob,Grep" ;;
esac

# Start Claude Code in tmux
tmux new-window -t "$TMUX_SESSION" -n "$WORKER_NAME" \
  "cd '$WORK_DIR' && claude \
    --dangerously-load-development-channels server:discord-filtered \
    --mcp-config '$WORKER_DIR/.mcp.json' \
    --allowedTools '$ALLOWED_TOOLS' \
    'Read $WORKER_DIR/task.md and $WORKER_DIR/context.md, then begin work. Follow instructions in $WORKER_DIR/CLAUDE.md.'"

# Update tracking.json
if [ ! -f "$TRACKING" ]; then
  echo '[]' > "$TRACKING"
fi
UPDATED=$(jq ". + [{
  \"name\": \"$WORKER_NAME\",
  \"channelId\": \"$CHANNEL_ID\",
  \"workDir\": \"$WORK_DIR\",
  \"intent\": \"$INTENT\",
  \"status\": \"active\",
  \"started\": \"$(date -Iseconds)\"
}]" "$TRACKING")
echo "$UPDATED" > "$TRACKING"

echo "Worker '$WORKER_NAME' spawned. Discord channel: $CHANNEL_ID"
echo "Talk to it in the new Discord channel."
```

- [ ] **Step 2: Implement dissolve-worker.sh**

`scripts/dissolve-worker.sh`:
```bash
#!/bin/bash
set -euo pipefail

while [[ $# -gt 0 ]]; do
  case $1 in
    --name) WORKER_NAME="$2"; shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

: "${WORKER_NAME:?--name is required}"

ONKOL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="$ONKOL_DIR/config.json"
BOT_TOKEN=$(jq -r '.botToken' "$CONFIG")
NODE_NAME=$(jq -r '.nodeName' "$CONFIG")
TMUX_SESSION="onkol-${NODE_NAME}"
WORKER_DIR="$ONKOL_DIR/workers/$WORKER_NAME"
TRACKING="$ONKOL_DIR/workers/tracking.json"

# Get channel ID from tracking
CHANNEL_ID=$(jq -r ".[] | select(.name == \"$WORKER_NAME\") | .channelId" "$TRACKING")

# Check learnings file
if [ ! -s "$WORKER_DIR/learnings.md" ]; then
  echo "WARNING: No learnings found at $WORKER_DIR/learnings.md"
  echo "Worker should write learnings before dissolution."
fi

# Copy learnings to knowledge base
DATE=$(date +%Y-%m-%d)
KNOWLEDGE_DIR="$ONKOL_DIR/knowledge"
mkdir -p "$KNOWLEDGE_DIR"

if [ -s "$WORKER_DIR/learnings.md" ]; then
  cp "$WORKER_DIR/learnings.md" "$KNOWLEDGE_DIR/${DATE}-${WORKER_NAME}.md"

  # Update index.json
  INDEX="$KNOWLEDGE_DIR/index.json"
  if [ ! -f "$INDEX" ]; then
    echo '[]' > "$INDEX"
  fi
  TASK_DESC=$(jq -r ".[] | select(.name == \"$WORKER_NAME\") | .intent" "$TRACKING" 2>/dev/null || echo "unknown")
  WORK_DIR=$(jq -r ".[] | select(.name == \"$WORKER_NAME\") | .workDir" "$TRACKING" 2>/dev/null || echo "unknown")
  UPDATED_INDEX=$(jq ". + [{
    \"file\": \"${DATE}-${WORKER_NAME}.md\",
    \"date\": \"$DATE\",
    \"tags\": [],
    \"project\": \"$WORK_DIR\",
    \"summary\": \"Learnings from worker $WORKER_NAME ($TASK_DESC)\"
  }]" "$INDEX")
  echo "$UPDATED_INDEX" > "$INDEX"
  echo "Learnings saved to $KNOWLEDGE_DIR/${DATE}-${WORKER_NAME}.md"
fi

# Kill tmux window (if exists)
tmux kill-window -t "${TMUX_SESSION}:${WORKER_NAME}" 2>/dev/null || true

# Delete Discord channel (if exists)
if [ -n "$CHANNEL_ID" ] && [ "$CHANNEL_ID" != "null" ]; then
  curl -s -X DELETE \
    "https://discord.com/api/v10/channels/${CHANNEL_ID}" \
    -H "Authorization: Bot ${BOT_TOKEN}" > /dev/null 2>&1 || true
  echo "Discord channel deleted."
fi

# Archive worker directory
ARCHIVE_DIR="$ONKOL_DIR/workers/.archive/${DATE}-${WORKER_NAME}"
mkdir -p "$ONKOL_DIR/workers/.archive"
mv "$WORKER_DIR" "$ARCHIVE_DIR"
echo "Worker directory archived to $ARCHIVE_DIR"

# Remove from tracking
UPDATED=$(jq "[.[] | select(.name != \"$WORKER_NAME\")]" "$TRACKING")
echo "$UPDATED" > "$TRACKING"

echo "Worker '$WORKER_NAME' dissolved."
```

- [ ] **Step 3: Implement utility scripts**

`scripts/list-workers.sh`:
```bash
#!/bin/bash
ONKOL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TRACKING="$ONKOL_DIR/workers/tracking.json"

if [ ! -f "$TRACKING" ] || [ "$(jq length "$TRACKING")" -eq 0 ]; then
  echo "No active workers."
  exit 0
fi

echo "Active workers:"
jq -r '.[] | "  [\(.status)] \(.name) — intent: \(.intent), dir: \(.workDir), started: \(.started)"' "$TRACKING"
```

`scripts/check-worker.sh`:
```bash
#!/bin/bash
while [[ $# -gt 0 ]]; do
  case $1 in
    --name) WORKER_NAME="$2"; shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

: "${WORKER_NAME:?--name is required}"

ONKOL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
STATUS_FILE="$ONKOL_DIR/workers/$WORKER_NAME/status.json"

if [ ! -f "$STATUS_FILE" ]; then
  echo "Worker '$WORKER_NAME' not found or has no status file."
  exit 1
fi

jq '.' "$STATUS_FILE"
```

`scripts/healthcheck.sh`:
```bash
#!/bin/bash
# Cron-based health check. Compares tracking.json against tmux windows.
# If a worker is tracked but its tmux window is gone, sends alert to Discord.

ONKOL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="$ONKOL_DIR/config.json"
TRACKING="$ONKOL_DIR/workers/tracking.json"

if [ ! -f "$TRACKING" ] || [ "$(jq length "$TRACKING")" -eq 0 ]; then
  exit 0
fi

BOT_TOKEN=$(jq -r '.botToken' "$CONFIG")
ORCHESTRATOR_CHANNEL=$(jq -r '.orchestratorChannelId' "$CONFIG")
NODE_NAME=$(jq -r '.nodeName' "$CONFIG")
TMUX_SESSION="onkol-${NODE_NAME}"

WINDOWS=$(tmux list-windows -t "$TMUX_SESSION" -F '#{window_name}' 2>/dev/null || echo "")

jq -r '.[] | select(.status == "active") | .name' "$TRACKING" | while read -r WORKER; do
  if ! echo "$WINDOWS" | grep -q "^${WORKER}$"; then
    # Worker is tracked but tmux window is gone
    curl -s -X POST \
      "https://discord.com/api/v10/channels/${ORCHESTRATOR_CHANNEL}/messages" \
      -H "Authorization: Bot ${BOT_TOKEN}" \
      -H "Content-Type: application/json" \
      -d "{\"content\": \"[healthcheck] Worker **${WORKER}** appears to have crashed. Its tmux window is gone but it's still tracked. Please check and decide: respawn or dissolve.\"}" \
      > /dev/null 2>&1
  fi
done
```

`scripts/start-orchestrator.sh`:
```bash
#!/bin/bash
ONKOL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="$ONKOL_DIR/config.json"
NODE_NAME=$(jq -r '.nodeName' "$CONFIG")
TMUX_SESSION="onkol-${NODE_NAME}"

tmux has-session -t "$TMUX_SESSION" 2>/dev/null || \
  tmux new-session -d -s "$TMUX_SESSION" \
    "cd '$ONKOL_DIR' && claude \
      --dangerously-load-development-channels server:discord-filtered \
      --mcp-config '$ONKOL_DIR/.mcp.json'"
```

- [ ] **Step 4: Make all scripts executable**

```bash
chmod +x scripts/*.sh
```

- [ ] **Step 5: Commit**

```bash
git add scripts/
git commit -m "feat: worker lifecycle scripts (spawn, dissolve, list, check, healthcheck, start)"
```

---

### Task 10: Setup Wizard CLI

**Files:**
- Modify: `src/cli/index.ts`
- Create: `src/cli/prompts.ts`
- Create: `src/cli/systemd.ts`

The interactive `npx onkol setup` command.

- [ ] **Step 1: Implement prompts**

`src/cli/prompts.ts`:
```typescript
import inquirer from 'inquirer'

export interface SetupAnswers {
  installDir: string
  nodeName: string
  botToken: string
  guildId: string
  registryPath: string | null
  registryMode: 'import' | 'skip'
  serviceMode: 'import' | 'auto' | 'skip'
  serviceSummaryPath: string | null
  plugins: string[]
}

export async function runSetupPrompts(homeDir: string): Promise<SetupAnswers> {
  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'installDir',
      message: 'Where should Onkol live?',
      default: `${homeDir}/onkol`,
    },
    {
      type: 'input',
      name: 'nodeName',
      message: 'What should this node be called? (shows up on Discord)',
    },
    {
      type: 'password',
      name: 'botToken',
      message: 'Discord bot token:',
      mask: '*',
    },
    {
      type: 'input',
      name: 'guildId',
      message: 'Discord server (guild) ID:',
    },
    {
      type: 'list',
      name: 'registryMode',
      message: 'Do you have a registry file for this VM? (secrets, endpoints, ports)',
      choices: [
        { name: 'Yes, import from file', value: 'import' },
        { name: 'Skip for now', value: 'skip' },
      ],
    },
    {
      type: 'input',
      name: 'registryPath',
      message: 'Path to registry file:',
      when: (a: any) => a.registryMode === 'import',
    },
    {
      type: 'list',
      name: 'serviceMode',
      message: 'Service summary for this VM?',
      choices: [
        { name: 'Auto-discover (scan for running services)', value: 'auto' },
        { name: 'Import from file', value: 'import' },
        { name: 'Skip for now', value: 'skip' },
      ],
    },
    {
      type: 'input',
      name: 'serviceSummaryPath',
      message: 'Path to service summary file:',
      when: (a: any) => a.serviceMode === 'import',
    },
    {
      type: 'checkbox',
      name: 'plugins',
      message: 'Which Claude Code plugins should workers have?',
      choices: [
        { name: 'context7', value: 'context7', checked: true },
        { name: 'superpowers', value: 'superpowers', checked: true },
        { name: 'code-simplifier', value: 'code-simplifier', checked: true },
        { name: 'frontend-design', value: 'frontend-design', checked: false },
      ],
    },
  ])

  return {
    ...answers,
    registryPath: answers.registryPath || null,
    serviceSummaryPath: answers.serviceSummaryPath || null,
  }
}
```

- [ ] **Step 2: Implement systemd generator**

`src/cli/systemd.ts`:
```typescript
export function generateSystemdUnit(nodeName: string, user: string, onkolDir: string): string {
  return `[Unit]
Description=Onkol Node: ${nodeName}
After=network.target

[Service]
Type=forking
User=${user}
ExecStart=${onkolDir}/scripts/start-orchestrator.sh
ExecStop=/usr/bin/tmux kill-session -t onkol-${nodeName}
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
`
}

export function generateCrontab(onkolDir: string): string {
  return `*/5 * * * * ${onkolDir}/scripts/healthcheck.sh
0 4 * * * find ${onkolDir}/workers/.archive -maxdepth 1 -mtime +30 -exec rm -rf {} \\;
`
}
```

- [ ] **Step 3: Implement CLI entry point**

`src/cli/index.ts`:
```typescript
#!/usr/bin/env node
import { program } from 'commander'
import chalk from 'chalk'
import { mkdirSync, writeFileSync, readFileSync, copyFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import { execSync } from 'child_process'
import { runSetupPrompts } from './prompts.js'
import { createCategory, createChannel } from './discord-api.js'
import { discoverServices, formatServicesMarkdown } from './auto-discover.js'
import { renderOrchestratorClaude, renderSettings } from './templates.js'
import { generateSystemdUnit, generateCrontab } from './systemd.js'

program
  .name('onkol')
  .description('Decentralized on-call agent system')
  .version('0.1.0')

program
  .command('setup')
  .description('Set up an Onkol node on this VM')
  .action(async () => {
    console.log(chalk.bold('\nWelcome to Onkol Setup\n'))

    const homeDir = process.env.HOME || '/root'
    const answers = await runSetupPrompts(homeDir)
    const dir = resolve(answers.installDir)

    // Create directory structure
    console.log(chalk.gray('Creating directories...'))
    for (const sub of ['knowledge', 'workers', 'workers/.archive', 'scripts', 'plugins/discord-filtered', '.claude']) {
      mkdirSync(resolve(dir, sub), { recursive: true })
    }

    // Write config.json
    const user = process.env.USER || 'root'
    const allowedUsers: string[] = [] // User will add their Discord ID via Discord pairing

    // Create Discord category and orchestrator channel
    console.log(chalk.gray('Creating Discord category and channel...'))
    const category = await createCategory(answers.botToken, answers.guildId, answers.nodeName)
    const orchChannel = await createChannel(answers.botToken, answers.guildId, 'orchestrator', category.id)

    const config = {
      nodeName: answers.nodeName,
      botToken: answers.botToken,
      guildId: answers.guildId,
      categoryId: category.id,
      orchestratorChannelId: orchChannel.id,
      allowedUsers,
      maxWorkers: 3,
      installDir: dir,
      plugins: answers.plugins,
    }
    writeFileSync(resolve(dir, 'config.json'), JSON.stringify(config, null, 2), { mode: 0o600 })

    // Handle registry
    if (answers.registryMode === 'import' && answers.registryPath) {
      copyFileSync(answers.registryPath, resolve(dir, 'registry.json'))
    } else {
      writeFileSync(resolve(dir, 'registry.json'), '{}')
    }

    // Handle services
    let servicesMd = '# Services\n\nNo services configured yet.\n'
    if (answers.serviceMode === 'auto') {
      console.log(chalk.gray('Discovering services...'))
      const services = discoverServices()
      servicesMd = formatServicesMarkdown(services)
      console.log(chalk.green(`Found ${services.length} services.`))
    } else if (answers.serviceMode === 'import' && answers.serviceSummaryPath) {
      servicesMd = readFileSync(answers.serviceSummaryPath, 'utf-8')
    }
    writeFileSync(resolve(dir, 'services.md'), servicesMd)

    // Generate CLAUDE.md
    const claudeMd = renderOrchestratorClaude({ nodeName: answers.nodeName, maxWorkers: 3 })
    writeFileSync(resolve(dir, 'CLAUDE.md'), claudeMd)

    // Generate .claude/settings.json
    const settings = renderSettings({ bashLogPath: resolve(dir, 'bash-log.txt') })
    writeFileSync(resolve(dir, '.claude/settings.json'), settings)

    // Write orchestrator .mcp.json
    const pluginPath = resolve(dir, 'plugins/discord-filtered/index.ts')
    const mcpJson = {
      mcpServers: {
        'discord-filtered': {
          command: 'bun',
          args: [pluginPath],
          env: {
            DISCORD_BOT_TOKEN: answers.botToken,
            DISCORD_CHANNEL_ID: orchChannel.id,
            DISCORD_ALLOWED_USERS: JSON.stringify(allowedUsers),
          },
        },
      },
    }
    writeFileSync(resolve(dir, '.mcp.json'), JSON.stringify(mcpJson, null, 2))

    // Initialize tracking and knowledge index
    writeFileSync(resolve(dir, 'workers/tracking.json'), '[]')
    writeFileSync(resolve(dir, 'knowledge/index.json'), '[]')
    writeFileSync(resolve(dir, 'state.md'), '')

    // Copy scripts (they're part of the npm package)
    const scriptsSource = resolve(__dirname, '../../scripts')
    if (existsSync(scriptsSource)) {
      for (const script of ['spawn-worker.sh', 'dissolve-worker.sh', 'list-workers.sh', 'check-worker.sh', 'healthcheck.sh', 'start-orchestrator.sh']) {
        const src = resolve(scriptsSource, script)
        const dst = resolve(dir, 'scripts', script)
        if (existsSync(src)) {
          copyFileSync(src, dst)
          execSync(`chmod +x "${dst}"`)
        }
      }
    }

    // Copy plugin source
    const pluginSource = resolve(__dirname, '../plugin')
    if (existsSync(pluginSource)) {
      for (const file of ['index.ts', 'mcp-server.ts', 'discord-client.ts', 'message-batcher.ts']) {
        const src = resolve(pluginSource, file)
        const dst = resolve(dir, 'plugins/discord-filtered', file)
        if (existsSync(src)) copyFileSync(src, dst)
      }
    }

    // Generate systemd unit
    const systemdUnit = generateSystemdUnit(answers.nodeName, user, dir)
    const unitPath = `/etc/systemd/system/onkol-${answers.nodeName}.service`
    console.log(chalk.yellow(`\nSystemd service file generated. To install:`))
    console.log(chalk.gray(`  sudo tee ${unitPath} << 'EOF'\n${systemdUnit}EOF`))
    console.log(chalk.gray(`  sudo systemctl daemon-reload`))
    console.log(chalk.gray(`  sudo systemctl enable onkol-${answers.nodeName}`))

    // Generate crontab
    const cron = generateCrontab(dir)
    console.log(chalk.yellow(`\nCron jobs for health checks and cleanup:`))
    console.log(chalk.gray(`  Add to crontab (crontab -e):\n${cron}`))

    // Done
    console.log(chalk.green.bold(`\n✓ Onkol node "${answers.nodeName}" set up at ${dir}`))
    console.log(chalk.green(`✓ Discord category "${answers.nodeName}" created with #orchestrator channel`))
    console.log(chalk.gray(`\nTo start manually:`))
    console.log(chalk.gray(`  ${dir}/scripts/start-orchestrator.sh`))
    console.log(chalk.gray(`\nIMPORTANT: Add your Discord user ID to config.json allowedUsers array.`))
  })

program.parse()
```

- [ ] **Step 4: Verify compilation**

```bash
npx tsc --noEmit
```

Expected: no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/cli/ templates/
git commit -m "feat: setup wizard CLI with prompts, auto-discovery, Discord setup, systemd generation"
```

---

### Task 11: Integration Verification

**Files:** None created — manual testing and verification.

- [ ] **Step 1: Build the project**

```bash
npm run build
```

Expected: clean build, `dist/` populated.

- [ ] **Step 2: Run all unit tests**

```bash
bun test
```

Expected: all tests pass.

- [ ] **Step 3: Verify CLI runs**

```bash
node dist/cli/index.js --help
```

Expected: shows "onkol" help with "setup" command.

- [ ] **Step 4: Verify plugin compiles with Bun**

```bash
bun build src/plugin/index.ts --outdir /tmp/onkol-check --target bun
```

Expected: clean build.

- [ ] **Step 5: Verify scripts are syntactically valid**

```bash
bash -n scripts/spawn-worker.sh
bash -n scripts/dissolve-worker.sh
bash -n scripts/list-workers.sh
bash -n scripts/check-worker.sh
bash -n scripts/healthcheck.sh
bash -n scripts/start-orchestrator.sh
```

Expected: no syntax errors.

- [ ] **Step 6: Commit final state**

```bash
git add -A
git commit -m "chore: integration verification — all tests pass, builds clean"
```

---

## Execution Order Summary

| Task | Component | Dependencies | Estimated Steps |
|------|-----------|-------------|-----------------|
| 1 | Project scaffolding | None | 6 |
| 2 | Message batcher | Task 1 | 5 |
| 3 | MCP server | Task 1 | 5 |
| 4 | Discord client | Task 1 | 5 |
| 5 | Plugin entry point | Tasks 2, 3, 4 | 3 |
| 6 | Discord API helpers | Task 1 | 5 |
| 7 | Service auto-discovery | Task 1 | 5 |
| 8 | Template generation | Task 1 | 5 |
| 9 | Worker lifecycle scripts | Task 6 | 5 |
| 10 | Setup wizard CLI | Tasks 6, 7, 8 | 5 |
| 11 | Integration verification | All | 6 |

**Parallelizable groups:**
- Tasks 2, 3, 4, 6, 7, 8 are all independent of each other (only depend on Task 1)
- Task 5 depends on 2+3+4
- Task 9 depends on 6
- Task 10 depends on 6+7+8
- Task 11 depends on all
