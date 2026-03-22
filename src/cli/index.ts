#!/usr/bin/env node
import { dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

import { program } from 'commander'
import chalk from 'chalk'
import { mkdirSync, writeFileSync, readFileSync, copyFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import { execSync } from 'child_process'
import { runSetupPrompts } from './prompts.js'
import { createCategory, createChannel, validateBotToken, checkGatewayIntents } from './discord-api.js'
import { discoverServices, formatServicesMarkdown } from './auto-discover.js'
import { renderOrchestratorClaude, renderSettings } from './templates.js'
import { generateSystemdUnit, generateCrontab } from './systemd.js'

program
  .name('onkol')
  .description('Decentralized on-call agent system')
  .version('0.1.0')

interface SetupCheckpoint {
  answers: import('./prompts.js').SetupAnswers
  completed: string[]
  categoryId?: string
  orchChannelId?: string
}

function loadCheckpoint(homeDir: string): SetupCheckpoint | null {
  const checkpointPath = resolve(homeDir, '.onkol-setup-checkpoint.json')
  if (existsSync(checkpointPath)) {
    try {
      return JSON.parse(readFileSync(checkpointPath, 'utf-8'))
    } catch { return null }
  }
  return null
}

function saveCheckpoint(homeDir: string, checkpoint: SetupCheckpoint): void {
  writeFileSync(resolve(homeDir, '.onkol-setup-checkpoint.json'), JSON.stringify(checkpoint, null, 2))
}

function clearCheckpoint(homeDir: string): void {
  const p = resolve(homeDir, '.onkol-setup-checkpoint.json')
  if (existsSync(p)) { const { unlinkSync } = require('fs'); unlinkSync(p) }
}

function markStep(homeDir: string, checkpoint: SetupCheckpoint, step: string): void {
  checkpoint.completed.push(step)
  saveCheckpoint(homeDir, checkpoint)
}

function checkDependencies(): void {
  console.log(chalk.bold('Checking dependencies...\n'))

  interface Dep {
    name: string
    check: string
    installHint: string
    required: boolean
  }

  const deps: Dep[] = [
    {
      name: 'claude',
      check: 'claude --version',
      installHint: 'Install Claude Code: https://docs.anthropic.com/en/docs/claude-code/getting-started',
      required: true,
    },
    {
      name: 'bun',
      check: 'bun --version',
      installHint: 'Install Bun: curl -fsSL https://bun.sh/install | bash',
      required: true,
    },
    {
      name: 'tmux',
      check: 'tmux -V',
      installHint: 'Install tmux:\n    Ubuntu/Debian: sudo apt install tmux\n    RHEL/CentOS:  sudo yum install tmux\n    Arch:         sudo pacman -S tmux\n    macOS:        brew install tmux',
      required: true,
    },
    {
      name: 'jq',
      check: 'jq --version',
      installHint: 'Install jq:\n    Ubuntu/Debian: sudo apt install jq\n    RHEL/CentOS:  sudo yum install jq\n    Arch:         sudo pacman -S jq\n    macOS:        brew install jq',
      required: true,
    },
    {
      name: 'curl',
      check: 'curl --version',
      installHint: 'Install curl:\n    Ubuntu/Debian: sudo apt install curl\n    RHEL/CentOS:  sudo yum install curl',
      required: true,
    },
  ]

  const missing: Dep[] = []
  for (const dep of deps) {
    try {
      execSync(dep.check, { stdio: 'pipe' })
      console.log(chalk.green(`  ✓ ${dep.name}`))
    } catch {
      console.log(chalk.red(`  ✗ ${dep.name} — not found`))
      missing.push(dep)
    }
  }

  if (missing.length > 0) {
    console.log(chalk.red(`\nMissing ${missing.length} required dependencies:\n`))
    for (const dep of missing) {
      console.log(chalk.yellow(`  ${dep.name}:`))
      console.log(chalk.gray(`    ${dep.installHint}\n`))
    }
    console.log(chalk.red('Install the missing dependencies and run `npx onkol setup` again.'))
    process.exit(1)
  }

  console.log(chalk.green('\n  All dependencies found.\n'))
}

program
  .command('setup')
  .description('Set up an Onkol node on this VM')
  .action(async () => {
    console.log(chalk.bold('\nWelcome to Onkol Setup\n'))

    // Check all dependencies before doing anything
    checkDependencies()

    const homeDir = process.env.HOME || '/root'
    let answers: import('./prompts.js').SetupAnswers
    let checkpoint: SetupCheckpoint

    // Check for existing checkpoint
    const existing = loadCheckpoint(homeDir)
    if (existing) {
      const { resume } = await (await import('inquirer')).default.prompt([{
        type: 'list',
        name: 'resume',
        message: `Found a previous setup attempt (${existing.completed.length} steps completed). What do you want to do?`,
        choices: [
          { name: `Resume from where it left off (node: ${existing.answers.nodeName})`, value: 'resume' },
          { name: 'Start fresh', value: 'fresh' },
        ],
      }])
      if (resume === 'resume') {
        answers = existing.answers
        checkpoint = existing
        console.log(chalk.green(`Resuming setup for "${answers.nodeName}". Skipping ${checkpoint.completed.length} completed steps.\n`))
      } else {
        answers = await runSetupPrompts(homeDir)
        checkpoint = { answers, completed: [] }
        saveCheckpoint(homeDir, checkpoint)
      }
    } else {
      answers = await runSetupPrompts(homeDir)
      checkpoint = { answers, completed: [] }
      saveCheckpoint(homeDir, checkpoint)
    }

    const dir = resolve(answers.installDir)

    const skip = (step: string) => checkpoint.completed.includes(step)

    // Create directory structure
    if (!skip('directories')) {
      console.log(chalk.gray('Creating directories...'))
      for (const sub of ['knowledge', 'workers', 'workers/.archive', 'scripts', 'plugins/discord-filtered', '.claude']) {
        mkdirSync(resolve(dir, sub), { recursive: true })
      }
      markStep(homeDir, checkpoint, 'directories')
    }

    // Build allowed users list from Discord user ID prompt
    const user = process.env.USER || 'root'
    const allowedUsers: string[] = []
    if (answers.discordUserId.trim()) {
      allowedUsers.push(answers.discordUserId.trim())
    }

    // --- Validate Discord bot token and intents ---
    if (!skip('discord')) {
      console.log(chalk.gray('Validating Discord bot token...'))
      const tokenCheck = await validateBotToken(answers.botToken)
      if (!tokenCheck.ok) {
        console.error(chalk.red(`\nFATAL: ${tokenCheck.error}`))
        console.error(chalk.yellow('\nYour answers have been saved. Fix the issue and run `npx onkol setup` again to resume.'))
        process.exit(1)
      }
      console.log(chalk.green('✓ Bot token is valid'))

      console.log(chalk.gray('Checking gateway intents...'))
      const intentWarning = await checkGatewayIntents(answers.botToken)
      if (intentWarning) {
        console.error(chalk.red(`\nFATAL: ${intentWarning}`))
        console.error(chalk.yellow('\nEnable the required intent and run `npx onkol setup` again to resume.'))
        process.exit(1)
      }
      console.log(chalk.green('✓ Message Content intent is enabled'))
    }

    // --- CRITICAL: Create Discord category and orchestrator channel ---
    let categoryId = checkpoint.categoryId || ''
    let orchChannelId = checkpoint.orchChannelId || ''
    if (!skip('discord')) {
      console.log(chalk.gray('Creating Discord category and channel...'))
      try {
        const category = await createCategory(answers.botToken, answers.guildId, answers.nodeName)
        const orchChannel = await createChannel(answers.botToken, answers.guildId, 'orchestrator', category.id)
        categoryId = category.id
        orchChannelId = orchChannel.id
        checkpoint.categoryId = categoryId
        checkpoint.orchChannelId = orchChannelId
        markStep(homeDir, checkpoint, 'discord')
      } catch (err) {
        console.error(chalk.red(`\nFATAL: Could not create Discord category/channel.`))
        console.error(chalk.red(`${err instanceof Error ? err.message : err}`))
        console.error(chalk.red('\nCheck that:'))
        console.error(chalk.red('  1. Your bot token is correct'))
        console.error(chalk.red('  2. Your server (guild) ID is correct'))
        console.error(chalk.red('  3. The bot has been invited to the server with "Manage Channels" permission'))
        console.error(chalk.yellow('\nYour answers have been saved. Fix the issue and run `npx onkol setup` again to resume.'))
        process.exit(1)
      }
      console.log(chalk.green('✓ Discord category and #orchestrator channel created'))
    } else {
      console.log(chalk.gray('  Discord category already created, skipping'))
    }

    // Write config.json
    if (!skip('config')) {
      const config = {
        nodeName: answers.nodeName,
        botToken: answers.botToken,
        guildId: answers.guildId,
        categoryId,
        orchestratorChannelId: orchChannelId,
        allowedUsers,
        maxWorkers: 3,
        installDir: dir,
        plugins: answers.plugins,
      }
      writeFileSync(resolve(dir, 'config.json'), JSON.stringify(config, null, 2), { mode: 0o600 })
      markStep(homeDir, checkpoint, 'config')
    }

    // Write files (registry, services, CLAUDE.md, settings, mcp.json, state)
    if (!skip('files')) {
      // Handle registry
      if (answers.registryMode === 'import' && answers.registryPath) {
        copyFileSync(answers.registryPath, resolve(dir, 'registry.json'))
      } else if (answers.registryMode !== 'prompt') {
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
      if (answers.serviceMode !== 'prompt') {
        writeFileSync(resolve(dir, 'services.md'), servicesMd)
      }

      // Generate CLAUDE.md, settings, mcp.json, state files
      writeFileSync(resolve(dir, 'CLAUDE.md'), renderOrchestratorClaude({ nodeName: answers.nodeName, maxWorkers: 3 }))
      writeFileSync(resolve(dir, '.claude/settings.json'), renderSettings({ bashLogPath: resolve(dir, 'bash-log.txt') }))

      const pluginPath = resolve(dir, 'plugins/discord-filtered/index.ts')
      const mcpJson = {
        mcpServers: {
          'discord-filtered': {
            command: 'bun',
            args: [pluginPath],
            env: {
              DISCORD_BOT_TOKEN: answers.botToken,
              DISCORD_CHANNEL_ID: orchChannelId,
              DISCORD_ALLOWED_USERS: JSON.stringify(allowedUsers),
              TMUX_TARGET: `onkol-${answers.nodeName}`,
            },
          },
        },
      }
      writeFileSync(resolve(dir, '.mcp.json'), JSON.stringify(mcpJson, null, 2))
      if (!existsSync(resolve(dir, 'workers/tracking.json'))) writeFileSync(resolve(dir, 'workers/tracking.json'), '[]')
      if (!existsSync(resolve(dir, 'knowledge/index.json'))) writeFileSync(resolve(dir, 'knowledge/index.json'), '[]')
      if (!existsSync(resolve(dir, 'state.md'))) writeFileSync(resolve(dir, 'state.md'), '')

      // Pre-accept Claude Code trust
      console.log(chalk.gray('Configuring Claude Code trust...'))
      const claudeJsonPath = resolve(homeDir, '.claude/.claude.json')
      try {
        const claudeJson = existsSync(claudeJsonPath) ? JSON.parse(readFileSync(claudeJsonPath, 'utf-8')) : {}
        if (!claudeJson.projects) claudeJson.projects = {}
        claudeJson.projects[dir] = { ...(claudeJson.projects[dir] || {}), allowedTools: [], hasTrustDialogAccepted: true }
        writeFileSync(claudeJsonPath, JSON.stringify(claudeJson, null, 2))
        console.log(chalk.green('✓ Claude Code trust pre-accepted'))
      } catch {
        console.log(chalk.yellow('⚠ Could not pre-accept trust dialog.'))
      }

      // Handle setup prompts
      const pendingPrompts: Array<{ target: string; prompt: string; status: string }> = []
      if (answers.registryPrompt) pendingPrompts.push({ target: 'registry.json', prompt: answers.registryPrompt, status: 'pending' })
      if (answers.servicesPrompt) pendingPrompts.push({ target: 'services.md', prompt: answers.servicesPrompt, status: 'pending' })
      if (answers.claudeMdPrompt) pendingPrompts.push({ target: 'CLAUDE.md', prompt: answers.claudeMdPrompt, status: 'pending' })
      if (pendingPrompts.length > 0) {
        writeFileSync(resolve(dir, 'setup-prompts.json'), JSON.stringify({ pending: pendingPrompts }, null, 2))
      }

      markStep(homeDir, checkpoint, 'files')
    } else {
      console.log(chalk.gray('  Config files already written, skipping'))
    }

    // --- CRITICAL: Copy scripts ---
    const requiredScripts = ['spawn-worker.sh', 'dissolve-worker.sh', 'list-workers.sh', 'check-worker.sh', 'healthcheck.sh', 'worker-watchdog.sh', 'start-orchestrator.sh']
    const scriptsSource = resolve(__dirname, '../../scripts')
    if (skip('scripts')) { console.log(chalk.gray('  Scripts already installed, skipping')) }
    else { console.log(chalk.gray('Copying scripts...'))
    if (!existsSync(scriptsSource)) {
      console.error(chalk.red(`\nFATAL: Scripts directory not found at ${scriptsSource}`))
      console.error(chalk.red('The onkol package appears to be corrupted. Reinstall with: npm install -g onkol'))
      process.exit(1)
    }
    for (const script of requiredScripts) {
      const src = resolve(scriptsSource, script)
      const dst = resolve(dir, 'scripts', script)
      if (!existsSync(src)) {
        console.error(chalk.red(`\nFATAL: Required script not found: ${src}`))
        process.exit(1)
      }
      copyFileSync(src, dst)
      execSync(`chmod +x "${dst}"`)
    }
    console.log(chalk.green(`✓ ${requiredScripts.length} scripts installed`))
    markStep(homeDir, checkpoint, 'scripts')
    }

    // --- CRITICAL: Copy plugin source ---
    const pluginFiles = ['index', 'mcp-server', 'discord-client', 'message-batcher']
    const pluginSourceDir = resolve(__dirname, '../plugin')
    const projectSrcDir = resolve(__dirname, '../../src/plugin')
    if (skip('plugin')) { console.log(chalk.gray('  Plugin already installed, skipping')) }
    else { console.log(chalk.gray('Installing discord-filtered plugin...'))

    let pluginCopied = 0
    for (const base of pluginFiles) {
      const dst = resolve(dir, 'plugins/discord-filtered', `${base}.ts`)
      // Try .ts from project src first, then .ts from dist, then .js from dist
      const candidates = [
        resolve(projectSrcDir, `${base}.ts`),
        resolve(pluginSourceDir, `${base}.ts`),
        resolve(pluginSourceDir, `${base}.js`),
      ]
      const found = candidates.find(c => existsSync(c))
      if (found) {
        copyFileSync(found, found.endsWith('.js') ? resolve(dir, 'plugins/discord-filtered', `${base}.js`) : dst)
        pluginCopied++
      }
    }
    if (pluginCopied < pluginFiles.length) {
      console.error(chalk.red(`\nFATAL: Only ${pluginCopied}/${pluginFiles.length} plugin files found.`))
      console.error(chalk.red(`Searched in:\n  ${projectSrcDir}\n  ${pluginSourceDir}`))
      console.error(chalk.red('The onkol package appears to be corrupted. Reinstall with: npm install -g onkol'))
      process.exit(1)
    }

    // Create plugin package.json and install deps
    const pluginPkgJson = {
      name: 'discord-filtered',
      version: '0.1.0',
      private: true,
      dependencies: {
        '@modelcontextprotocol/sdk': '^1.0.0',
        'discord.js': '^14.0.0',
      },
    }
    writeFileSync(resolve(dir, 'plugins/discord-filtered/package.json'), JSON.stringify(pluginPkgJson, null, 2))
    console.log(chalk.gray('Installing plugin dependencies (bun install)...'))
    try {
      execSync('bun install', { cwd: resolve(dir, 'plugins/discord-filtered'), stdio: 'pipe' })
      console.log(chalk.green(`✓ Plugin installed with ${pluginCopied} files + dependencies`))
    } catch {
      console.error(chalk.red('\nFATAL: Failed to install plugin dependencies.'))
      console.error(chalk.red('Is bun installed? Install with: curl -fsSL https://bun.sh/install | bash'))
      console.error(chalk.yellow('\nYour progress has been saved. Fix the issue and run `npx onkol setup` again to resume.'))
      process.exit(1)
    }
    markStep(homeDir, checkpoint, 'plugin')
    }

    // Install systemd service
    const systemdUnit = generateSystemdUnit(answers.nodeName, user, dir)
    const unitPath = `/etc/systemd/system/onkol-${answers.nodeName}.service`
    console.log(chalk.gray('\nInstalling systemd service...'))
    try {
      writeFileSync(resolve(dir, `onkol-${answers.nodeName}.service`), systemdUnit)
      execSync(`sudo cp "${resolve(dir, `onkol-${answers.nodeName}.service`)}" "${unitPath}"`, { stdio: 'pipe' })
      execSync('sudo systemctl daemon-reload', { stdio: 'pipe' })
      execSync(`sudo systemctl enable onkol-${answers.nodeName}`, { stdio: 'pipe' })
      console.log(chalk.green(`✓ Systemd service installed and enabled`))
    } catch {
      console.log(chalk.yellow(`⚠ Could not install systemd service automatically (need sudo).`))
      console.log(chalk.yellow(`  To install manually:`))
      console.log(chalk.gray(`  sudo tee ${unitPath} << 'EOF'\n${systemdUnit}EOF`))
      console.log(chalk.gray(`  sudo systemctl daemon-reload`))
      console.log(chalk.gray(`  sudo systemctl enable onkol-${answers.nodeName}`))
    }

    // Install health check timers — try cron first, then systemd user timers
    console.log(chalk.gray('Installing health check timers...'))
    let timersInstalled = false
    // Try crontab
    try {
      execSync('which crontab', { stdio: 'pipe' })
      const cron = generateCrontab(dir)
      const existingCron = (() => { try { return execSync('crontab -l 2>/dev/null', { encoding: 'utf-8' }) } catch { return '' } })()
      if (!existingCron.includes(resolve(dir, 'scripts/healthcheck.sh'))) {
        const newCron = existingCron.trimEnd() + '\n' + cron
        execSync(`echo ${JSON.stringify(newCron)} | crontab -`, { stdio: 'pipe' })
      }
      console.log(chalk.green(`✓ Cron jobs installed (healthcheck every 5min, archive cleanup daily)`))
      timersInstalled = true
    } catch { /* crontab not available */ }
    // Fallback: systemd user timers (works on Arch, Fedora, etc. without cronie)
    if (!timersInstalled) {
      try {
        const installTimersScript = resolve(dir, 'scripts/install-timers.sh')
        if (existsSync(installTimersScript)) {
          execSync(`bash "${installTimersScript}"`, { stdio: 'pipe' })
        } else {
          // Create and run inline
          const timerDir = resolve(homeDir, '.config/systemd/user')
          mkdirSync(timerDir, { recursive: true })
          const healthcheckPath = resolve(dir, 'scripts/healthcheck.sh')
          const watchdogPath = resolve(dir, 'scripts/worker-watchdog.sh')
          writeFileSync(resolve(timerDir, 'onkol-healthcheck.service'), `[Unit]\nDescription=Onkol healthcheck\n[Service]\nType=oneshot\nExecStart=${healthcheckPath}\n`)
          writeFileSync(resolve(timerDir, 'onkol-healthcheck.timer'), `[Unit]\nDescription=Onkol healthcheck every 5min\n[Timer]\nOnBootSec=2min\nOnUnitActiveSec=5min\n[Install]\nWantedBy=timers.target\n`)
          writeFileSync(resolve(timerDir, 'onkol-worker-watchdog.service'), `[Unit]\nDescription=Onkol worker watchdog\n[Service]\nType=oneshot\nExecStart=${watchdogPath}\n`)
          writeFileSync(resolve(timerDir, 'onkol-worker-watchdog.timer'), `[Unit]\nDescription=Onkol worker watchdog every 3min\n[Timer]\nOnBootSec=3min\nOnUnitActiveSec=3min\n[Install]\nWantedBy=timers.target\n`)
          writeFileSync(resolve(timerDir, 'onkol-cleanup.service'), `[Unit]\nDescription=Onkol archive cleanup\n[Service]\nType=oneshot\nExecStart=/usr/bin/find ${resolve(dir, 'workers/.archive')} -maxdepth 1 -mtime +30 -exec rm -rf {} \\;\n`)
          writeFileSync(resolve(timerDir, 'onkol-cleanup.timer'), `[Unit]\nDescription=Onkol archive cleanup daily\n[Timer]\nOnCalendar=*-*-* 04:00:00\n[Install]\nWantedBy=timers.target\n`)
          execSync('systemctl --user daemon-reload', { stdio: 'pipe' })
          execSync('systemctl --user enable --now onkol-healthcheck.timer', { stdio: 'pipe' })
          execSync('systemctl --user enable --now onkol-worker-watchdog.timer', { stdio: 'pipe' })
          execSync('systemctl --user enable --now onkol-cleanup.timer', { stdio: 'pipe' })
        }
        console.log(chalk.green(`✓ Systemd user timers installed (healthcheck every 5min, cleanup daily)`))
        timersInstalled = true
      } catch { /* systemd timers failed too */ }
    }
    if (!timersInstalled) {
      console.log(chalk.yellow(`⚠ Could not install health check timers (no crontab or systemd --user).`))
      console.log(chalk.yellow(`  You'll need to set up periodic health checks manually.`))
    }

    // Report pending setup prompts
    const setupPromptsPath = resolve(dir, 'setup-prompts.json')
    if (existsSync(setupPromptsPath)) {
      try {
        const sp = JSON.parse(readFileSync(setupPromptsPath, 'utf-8'))
        const pending = (sp.pending || []).filter((p: any) => p.status === 'pending')
        if (pending.length > 0) {
          console.log(chalk.cyan('\nPending setup prompts saved. On first boot, the orchestrator will:'))
          for (const p of pending) {
            console.log(chalk.cyan(`  - Generate ${p.target} from your ${p.target === 'CLAUDE.md' ? 'description' : 'prompt'}`))
          }
        }
      } catch { /* ignore */ }
    }

    // Start orchestrator — try systemctl first (so service shows active), fall back to script
    console.log(chalk.gray('\nStarting orchestrator...'))
    let started = false
    try {
      execSync(`sudo systemctl start onkol-${answers.nodeName}`, { stdio: 'pipe', timeout: 60000 })
      // Wait for tmux session to appear (the start script itself verifies, but double-check)
      for (let i = 0; i < 5; i++) {
        try {
          execSync(`tmux has-session -t onkol-${answers.nodeName}`, { stdio: 'pipe' })
          started = true
          break
        } catch { /* not ready yet */ }
        execSync('sleep 2', { stdio: 'pipe' })
      }
      if (started) {
        console.log(chalk.green(`✓ Orchestrator started via systemd (tmux session "onkol-${answers.nodeName}")`))
      } else {
        // systemctl succeeded but tmux session not visible — likely PATH or env issue
        console.log(chalk.yellow(`⚠ systemctl started but tmux session not found. Trying direct start...`))
        try {
          const logs = execSync(`sudo journalctl -u onkol-${answers.nodeName} --no-pager -n 10 2>&1`, { encoding: 'utf-8' })
          if (logs.trim()) console.log(chalk.gray(`  Journal: ${logs.trim().split('\n').slice(-3).join('\n  ')}`))
        } catch { /* ignore */ }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.log(chalk.yellow(`⚠ systemctl start failed: ${msg.split('\n')[0]}`))
    }
    if (!started) {
      try {
        execSync(`bash "${resolve(dir, 'scripts/start-orchestrator.sh')}"`, { stdio: 'pipe', timeout: 60000 })
        // Verify the session is actually running
        execSync(`tmux has-session -t onkol-${answers.nodeName}`, { stdio: 'pipe' })
        started = true
        console.log(chalk.green(`✓ Orchestrator started in tmux session "onkol-${answers.nodeName}"`))
      } catch {
        console.log(chalk.red(`✗ Could not start orchestrator. The tmux session failed to stay alive.`))
        console.log(chalk.yellow(`  Debug steps:`))
        console.log(chalk.yellow(`    1. Run manually: bash ${dir}/scripts/start-orchestrator.sh`))
        console.log(chalk.yellow(`    2. Check: tmux attach -t onkol-${answers.nodeName}`))
        console.log(chalk.yellow(`    3. Verify claude works: claude --version`))
      }
    }

    // Setup complete — clear checkpoint
    clearCheckpoint(homeDir)

    // Done
    console.log(chalk.green.bold(`\n✓ Onkol node "${answers.nodeName}" is live!`))
    console.log(chalk.green(`✓ Discord category "${answers.nodeName}" created with #orchestrator channel`))
    if (allowedUsers.length > 0) {
      console.log(chalk.green(`✓ Allowed Discord users: ${allowedUsers.join(', ')}`))
    } else {
      console.log(chalk.yellow(`⚠ No Discord user ID configured. Add user IDs to config.json allowedUsers array.`))
    }
    console.log(chalk.gray(`\n  To attach to the session: tmux attach -t onkol-${answers.nodeName}`))
    console.log(chalk.gray(`  To check status: systemctl status onkol-${answers.nodeName}`))
  })

program.parse()
