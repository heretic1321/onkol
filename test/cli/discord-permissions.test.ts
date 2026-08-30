import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const root = resolve(import.meta.dir, '../..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')

describe('Discord status-card setup guidance', () => {
  it('includes Manage Messages in the interactive bot permission guide', () => {
    const prompts = read('src/cli/prompts.ts')

    expect(prompts).toContain('Manage Messages')
    expect(prompts).toContain('pin and update the session status card')
  })

  it('explains the required permission when channel setup fails', () => {
    const cli = read('src/cli/index.ts')

    expect(cli).toContain('Manage Channels" and "Manage Messages" permissions')
  })

  it('documents the pinned-card acceptance runbook', () => {
    const readme = read('README.md')

    for (const detail of [
      'exactly one pinned status card',
      'edited rather than replaced',
      'current model',
      'main-agent context usage',
      'auto-compaction percentage',
      'active subagents with their requested models',
      'weekly quota',
      'labeled unavailable',
      'existing pinned card is reused',
      'Manage Messages',
    ]) {
      expect(readme).toContain(detail)
    }
  })

  it('passes the configured node identity to the Claude bridge plugin', () => {
    const cli = read('src/cli/index.ts')
    const workerScript = read('scripts/spawn-worker.sh')
    const updateScript = read('scripts/update-and-restart.sh')

    expect(cli).toContain('NODE_NAME: answers.nodeName')
    expect(workerScript).toContain('"NODE_NAME": "$NODE_NAME"')
    expect(updateScript).toContain('env.NODE_NAME = $node')
  })
})
