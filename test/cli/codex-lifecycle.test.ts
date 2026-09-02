import { afterEach, describe, expect, it } from 'bun:test'
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { resolve } from 'path'
import { spawnSync } from 'child_process'

const sourceRoot = resolve(import.meta.dir, '../..')
const temporaryDirs: string[] = []

afterEach(() => {
  for (const dir of temporaryDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('Codex worker lifecycle', () => {
  it('creates an isolated worker, records it, and launches its tmux window', () => {
    const install = mkdtempSync(resolve(tmpdir(), "onkol-codex-'test-"))
    temporaryDirs.push(install)
    const scripts = resolve(install, 'scripts')
    const workers = resolve(install, 'workers')
    const project = resolve(install, `project with spaces $HOME 'single' "double"`)
    const fakeBin = resolve(install, 'fake-bin')
    mkdirSync(scripts)
    mkdirSync(workers)
    mkdirSync(project)
    mkdirSync(fakeBin)

    const spawnScript = resolve(scripts, 'spawn-codex-worker.sh')
    copyFileSync(resolve(sourceRoot, 'scripts/spawn-codex-worker.sh'), spawnScript)
    chmodSync(spawnScript, 0o755)
    writeFileSync(resolve(workers, 'tracking.json'), '[]\n')
    writeFileSync(resolve(install, 'config.json'), JSON.stringify({
      botToken: 'test-token',
      guildId: 'guild-1',
      categoryId: 'category-1',
      nodeName: 'test-vm',
      maxWorkers: 3,
      allowedUsers: ['user-1'],
      runtime: 'codex',
      codex: {
        model: 'gpt-5.6-sol',
        reasoningEffort: 'medium',
        wsPortBase: 19300,
        autoCompactPercent: 75,
      },
    }))

    const fakeLog = resolve(install, 'commands.log')
    const tmux = resolve(fakeBin, 'tmux')
    writeFileSync(tmux, `#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE_LOG"
if [ "$1" = new-window ]; then
  for arg do command="$arg"; done
  bash -n -c "$command" || exit 1
fi
exit 0
`)
    chmodSync(tmux, 0o755)
    const curl = resolve(fakeBin, 'curl')
    writeFileSync(curl, '#!/bin/sh\nprintf \'{"id":"worker-channel-1"}\\n\'\n')
    chmodSync(curl, 0o755)
    const effectiveLog = resolve(install, 'effective.log')
    const node = resolve(fakeBin, 'node')
    writeFileSync(node, `#!/bin/sh
printf '%s|%s|%s|%s\\n' "$ONKOL_ROLE" "$CODEX_MODEL" "$CODEX_REASONING_EFFORT" "$PROJECT_DIR" >> "$EFFECTIVE_LOG"
`)
    chmodSync(node, 0o755)

    const result = spawnSync('bash', [spawnScript,
      '--name', 'hr-feedback',
      '--dir', project,
      '--task', 'Build the feedback workflow',
      '--intent', 'feature',
      '--context', 'Preserve existing APIs',
    ], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}`, FAKE_LOG: fakeLog },
    })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain("Codex worker 'hr-feedback' spawned")
    const tracking = JSON.parse(readFileSync(resolve(workers, 'tracking.json'), 'utf8'))
    expect(tracking).toHaveLength(1)
    expect(tracking[0]).toMatchObject({
      name: 'hr-feedback',
      channelId: 'worker-channel-1',
      runtime: 'codex',
      wsPort: 19301,
      model: 'gpt-5.6-sol',
      reasoningEffort: 'medium',
    })
    expect(readFileSync(resolve(workers, 'hr-feedback/initial-prompt.md'), 'utf8')).toContain('ephemeral Onkol Codex worker')
    expect(readFileSync(resolve(workers, 'hr-feedback/initial-prompt.md'), 'utf8')).toContain('Do not spawn another Onkol worker')
    const launcher = readFileSync(resolve(workers, 'hr-feedback/start-worker.sh'), 'utf8')
    expect(launcher).toContain('export ONKOL_ROLE="worker"')
    expect(launcher).toContain("export CODEX_MODEL=\"$(jq -r '.codex.model // empty' \"$CONFIG\")\"")
    expect(launcher).toContain("export CODEX_REASONING_EFFORT=\"$(jq -r '.codex.reasoningEffort // empty' \"$CONFIG\")\"")
    expect(readFileSync(fakeLog, 'utf8')).toContain('new-window -t onkol-test-vm -n hr-feedback')

    const overrideResult = spawnSync('bash', [spawnScript,
      '--name', 'override-worker',
      '--dir', project,
      '--task', 'Use explicit settings',
      '--intent', 'fix',
      '--model', 'gpt-5.5',
      '--reasoning-effort', 'low',
    ], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}`, FAKE_LOG: fakeLog },
    })

    expect(overrideResult.status).toBe(0)
    const overrideLauncher = readFileSync(resolve(workers, 'override-worker/start-worker.sh'), 'utf8')
    expect(overrideLauncher).toContain('export CODEX_MODEL=gpt-5.5')
    expect(overrideLauncher).toContain('export CODEX_REASONING_EFFORT=low')

    const recoveredConfig = JSON.parse(readFileSync(resolve(install, 'config.json'), 'utf8'))
    recoveredConfig.codex.model = 'gpt-5.6-terra'
    recoveredConfig.codex.reasoningEffort = 'high'
    writeFileSync(resolve(install, 'config.json'), JSON.stringify(recoveredConfig))
    const recoveryEnv = {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH}`,
      EFFECTIVE_LOG: effectiveLog,
    }
    const recoveredDefault = spawnSync(
      'bash',
      [resolve(workers, 'hr-feedback/start-worker.sh')],
      { encoding: 'utf8', env: recoveryEnv },
    )
    const recoveredOverride = spawnSync(
      'bash',
      [resolve(workers, 'override-worker/start-worker.sh')],
      { encoding: 'utf8', env: recoveryEnv },
    )

    expect(recoveredDefault.status).toBe(0)
    expect(recoveredOverride.status).toBe(0)
    expect(readFileSync(effectiveLog, 'utf8').trim().split('\n')).toEqual([
      `worker|gpt-5.6-terra|high|${project}`,
      `worker|gpt-5.5|low|${project}`,
    ])
  })
})
