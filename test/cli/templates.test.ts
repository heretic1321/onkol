import { describe, it, expect } from 'bun:test'
import { renderOrchestratorClaude, renderSettings } from '../../src/cli/templates'

describe('renderOrchestratorClaude', () => {
  it('renders orchestrator CLAUDE.md with node name', () => {
    const result = renderOrchestratorClaude({ nodeName: 'loyalty-voicebot', maxWorkers: 3 })
    expect(result).toContain('loyalty-voicebot')
    expect(result).toContain('You do NOT solve tasks yourself')
    expect(result).toContain('Maximum 3 concurrent workers')
  })

  it('renders provider-neutral Codex orchestrator instructions', () => {
    const result = renderOrchestratorClaude({ nodeName: 'api-prod', maxWorkers: 5, runtime: 'codex' })
    expect(result).toContain('worker codex sessions')
    expect(result).toContain('scripts/spawn-worker.sh')
    expect(result).toContain('Maximum 5 concurrent workers')
  })
})

describe('renderSettings', () => {
  it('renders settings.json with bash log path', () => {
    const result = renderSettings({ bashLogPath: '/home/user/onkol/bash-log.txt' })
    expect(result).toContain('/home/user/onkol/bash-log.txt')
    expect(result).toContain('PreCompact')
  })
})
