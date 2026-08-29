import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const root = resolve(import.meta.dir, '../..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')

describe('Codex runtime packaging', () => {
  it('ships the bridge and its scoped Discord MCP helpers', () => {
    const pkg = JSON.parse(read('package.json'))
    expect(pkg.files).toContain('runtime/codex/*.js')
    expect(read('runtime/codex/codex-bridge.js')).toContain('AUTO_COMPACT_PERCENT')
    expect(read('runtime/codex/codex-bridge.js')).toContain('CONTEXT_DISPLAY')
    expect(read('runtime/codex/codex-bridge.js')).toContain('`${SYSTEM_INSTRUCTION}\\n\\n${initialPrompt}`')
    expect(read('runtime/codex/discord-mcp-server.js')).toContain('DISCORD_REPLY_TOKEN')
  })

  it('dispatches existing lifecycle entrypoints by configured runtime', () => {
    expect(read('scripts/start-orchestrator.sh')).toContain('start-codex-orchestrator.sh')
    expect(read('scripts/spawn-worker.sh')).toContain('spawn-codex-worker.sh')
    expect(read('scripts/dissolve-worker.sh')).toContain('codex mcp remove')
    expect(read('scripts/sync-codex-skills.sh')).toContain('mattpocock/skills')
    expect(read('scripts/sync-codex-skills.sh')).toContain('--global --agent codex')
  })

  it('supports channel-preserving Codex updates and explicit migration', () => {
    const cli = read('src/cli/index.ts')
    expect(cli).toContain(".option('--runtime <provider>'")
    expect(cli).toContain('Restarting Codex sessions in place')
    expect(cli).toContain('Cannot switch ${currentRuntime} → ${targetRuntime} with active workers')
    expect(cli).toContain('scripts/sync-codex-skills.sh')
  })
})
