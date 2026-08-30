import { afterEach, describe, expect, it } from 'bun:test'
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { resolve } from 'path'
import { spawnSync } from 'child_process'

const sourceRoot = resolve(import.meta.dir, '../..')
const temporaryDirs: string[] = []

afterEach(() => {
  for (const dir of temporaryDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('Codex orchestrator startup', () => {
  it('repairs a live worker session whose orchestrator window exited', () => {
    const install = mkdtempSync(resolve(tmpdir(), 'onkol-startup-test-'))
    temporaryDirs.push(install)
    const scripts = resolve(install, 'scripts')
    const runtime = resolve(install, 'runtime/codex')
    const socketDir = resolve(install, 'tmux')
    const fakeBin = resolve(install, 'fake-bin')
    mkdirSync(scripts, { recursive: true })
    mkdirSync(runtime, { recursive: true })
    mkdirSync(socketDir)
    mkdirSync(fakeBin)

    const startScript = resolve(scripts, 'start-codex-orchestrator.sh')
    copyFileSync(
      resolve(sourceRoot, 'scripts/start-codex-orchestrator.sh'),
      startScript,
    )
    chmodSync(startScript, 0o755)
    copyFileSync(
      resolve(sourceRoot, 'scripts/check-codex-orchestrator.sh'),
      resolve(scripts, 'check-codex-orchestrator.sh'),
    )
    chmodSync(resolve(scripts, 'check-codex-orchestrator.sh'), 0o755)
    writeFileSync(resolve(fakeBin, 'curl'), '#!/bin/sh\nexit 0\n')
    chmodSync(resolve(fakeBin, 'curl'), 0o755)
    writeFileSync(
      resolve(runtime, 'codex-bridge.js'),
      'setInterval(() => {}, 60_000)\n',
    )
    writeFileSync(
      resolve(install, 'config.json'),
      JSON.stringify({
        runtime: 'codex',
        nodeName: 'startup-fixture',
        botToken: 'test-token',
        guildId: 'guild-1',
        orchestratorChannelId: 'channel-1',
        allowedUsers: ['user-1'],
        codex: { wsPortBase: 28300 },
      }),
    )

    const { TMUX: _tmux, ...baseEnv } = process.env
    const env = {
      ...baseEnv,
      PATH: `${fakeBin}:${baseEnv.PATH}`,
      TMUX_TMPDIR: socketDir,
      ONKOL_STARTUP_TIMEOUT: '3',
    }
    const tmux = (...args: string[]) =>
      spawnSync('tmux', args, { encoding: 'utf8', env })

    const fixture = tmux(
      'new-session',
      '-d',
      '-s',
      'onkol-startup-fixture',
      '-n',
      'recovery',
      'while :; do sleep 10; done',
    )
    expect(fixture.status).toBe(0)

    try {
      const started = spawnSync('bash', [startScript], {
        encoding: 'utf8',
        env,
      })
      expect(started.status).toBe(0)
      expect(started.stdout).toContain('Codex orchestrator repaired')
      const windows = tmux(
        'list-windows',
        '-t',
        'onkol-startup-fixture',
        '-F',
        '#{window_name}',
      )
      expect(windows.stdout.split('\n')).toContain('orchestrator')
    } finally {
      tmux('kill-server')
    }
  })
})
