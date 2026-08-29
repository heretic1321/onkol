#!/usr/bin/env node
import { dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

import { program } from 'commander'
import chalk from 'chalk'
import { mkdirSync, writeFileSync, readFileSync, copyFileSync, existsSync, unlinkSync } from 'fs'
import { resolve } from 'path'
import { execSync } from 'child_process'
import { chooseRuntime, runSetupPrompts, type AgentRuntime } from './prompts.js'
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
  if (existsSync(p)) { unlinkSync(p) }
}

function markStep(homeDir: string, checkpoint: SetupCheckpoint, step: string): void {
  checkpoint.completed.push(step)
  saveCheckpoint(homeDir, checkpoint)
}

function checkDependencies(runtime: AgentRuntime): void {
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
      required: runtime === 'claude',
    },
    {
      name: 'bun',
      check: 'bun --version',
      installHint: 'Install Bun: curl -fsSL https://bun.sh/install | bash',
      required: runtime === 'claude',
    },
    {
      name: 'codex',
      check: 'codex --version && codex login status',
      installHint: 'Install and authenticate Codex, then run: codex login',
      required: runtime === 'codex',
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

  const MIN_CLAUDE_VERSION = '2.1.81'
  const missing: Dep[] = []
  const warnings: string[] = []

  for (const dep of deps) {
    if (!dep.required) continue
    try {
      const output = execSync(dep.check, { stdio: 'pipe', encoding: 'utf-8' }).trim()
      console.log(chalk.green(`  ✓ ${dep.name}`))

      // Check claude version meets minimum
      if (dep.name === 'claude') {
        const versionMatch = output.match(/(\d+\.\d+\.\d+)/)
        if (versionMatch) {
          const installed = versionMatch[1]
          const [iMaj, iMin, iPatch] = installed.split('.').map(Number)
          const [rMaj, rMin, rPatch] = MIN_CLAUDE_VERSION.split('.').map(Number)
          const tooOld = iMaj < rMaj || (iMaj === rMaj && iMin < rMin) || (iMaj === rMaj && iMin === rMin && iPatch < rPatch)
          if (tooOld) {
            warnings.push(`Claude Code ${installed} is too old. Onkol requires ${MIN_CLAUDE_VERSION}+ (for --dangerously-load-development-channels).`)
          }
        }
      }
    } catch {
      console.log(chalk.red(`  ✗ ${dep.name} — not found`))
      missing.push(dep)
    }
  }

  if (warnings.length > 0) {
    console.log('')
    for (const w of warnings) {
      console.log(chalk.red(`  ✗ ${w}`))
    }
    console.log(chalk.yellow(`\n  Update Claude Code: claude update`))
    console.log(chalk.yellow(`  Or reinstall: curl -fsSL https://claude.ai/install.sh | sh\n`))
    process.exit(1)
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

    const homeDir = process.env.HOME || '/root'
    const existing = loadCheckpoint(homeDir)
    const runtime: AgentRuntime = existing?.answers.runtime || (existing ? 'claude' : await chooseRuntime('codex'))

    // Check only the dependencies required by the selected provider.
    checkDependencies(runtime)

    let answers: import('./prompts.js').SetupAnswers
    let checkpoint: SetupCheckpoint

    // Check for existing checkpoint
    if (existing) {
      existing.answers.runtime ||= 'claude'
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
        answers = await runSetupPrompts(homeDir, runtime)
        checkpoint = { answers, completed: [] }
        saveCheckpoint(homeDir, checkpoint)
      }
    } else {
      answers = await runSetupPrompts(homeDir, runtime)
      checkpoint = { answers, completed: [] }
      saveCheckpoint(homeDir, checkpoint)
    }

    const dir = resolve(answers.installDir)

    const skip = (step: string) => checkpoint.completed.includes(step)

    // Create directory structure
    if (!skip('directories')) {
      console.log(chalk.gray('Creating directories...'))
      for (const sub of ['knowledge', 'workers', 'workers/.archive', 'scripts', 'plugins/discord-filtered', 'runtime/codex', '.claude']) {
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
        runtime: answers.runtime,
        nodeName: answers.nodeName,
        botToken: answers.botToken,
        guildId: answers.guildId,
        categoryId,
        orchestratorChannelId: orchChannelId,
        allowedUsers,
        maxWorkers: 3,
        installDir: dir,
        plugins: answers.plugins,
        ...(answers.runtime === 'codex' ? {
          codex: {
            home: answers.codexHome,
            model: answers.codexModel,
            reasoningEffort: answers.codexReasoningEffort,
            autoCompactPercent: answers.codexAutoCompactPercent,
            wsPortBase: 18300,
            syncMattPocockSkills: true,
          },
        } : {}),
        ...(answers.watchdogProvider !== 'skip' ? {
          watchdog: {
            provider: answers.watchdogProvider,
            model: answers.watchdogModel,
            apiKey: answers.watchdogApiKey,
            ...(answers.watchdogApiUrl ? { apiUrl: answers.watchdogApiUrl } : {}),
          },
        } : {}),
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
      const orchestratorInstructions = renderOrchestratorClaude({ nodeName: answers.nodeName, maxWorkers: 3, runtime: answers.runtime })
      writeFileSync(resolve(dir, 'CLAUDE.md'), orchestratorInstructions)
      writeFileSync(resolve(dir, 'AGENTS.md'), orchestratorInstructions)
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
      if (answers.runtime === 'claude') {
        writeFileSync(resolve(dir, '.mcp.json'), JSON.stringify(mcpJson, null, 2))
      }
      if (!existsSync(resolve(dir, 'workers/tracking.json'))) writeFileSync(resolve(dir, 'workers/tracking.json'), '[]')
      if (!existsSync(resolve(dir, 'knowledge/index.json'))) writeFileSync(resolve(dir, 'knowledge/index.json'), '[]')
      if (!existsSync(resolve(dir, 'state.md'))) writeFileSync(resolve(dir, 'state.md'), '')

      // Pre-accept Claude Code trust
      console.log(chalk.gray(`Configuring ${answers.runtime === 'codex' ? 'Codex' : 'Claude Code'} runtime...`))
      const claudeJsonPath = resolve(homeDir, '.claude/.claude.json')
      if (answers.runtime === 'claude') try {
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
    const requiredScripts = ['spawn-worker.sh', 'spawn-codex-worker.sh', 'dissolve-worker.sh', 'list-workers.sh', 'check-worker.sh', 'healthcheck.sh', 'worker-watchdog.sh', 'start-orchestrator.sh', 'start-codex-orchestrator.sh', 'restart-codex-session.sh', 'sync-codex-skills.sh', 'update-and-restart.sh']
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
    if (skip('plugin')) {
      console.log(chalk.gray('  Agent runtime already installed, skipping'))
    } else if (answers.runtime === 'codex') {
      console.log(chalk.gray('Installing Codex Discord runtime...'))
      const runtimeSource = resolve(__dirname, '../../runtime/codex')
      const runtimeTarget = resolve(dir, 'runtime/codex')
      for (const file of ['codex-bridge.js', 'discord-mcp-server.js', 'export-discord-range.js', 'package.json']) {
        const src = resolve(runtimeSource, file)
        if (!existsSync(src)) throw new Error(`Missing Codex runtime file: ${src}`)
        copyFileSync(src, resolve(runtimeTarget, file))
      }
      execSync('npm install --omit=dev', { cwd: runtimeTarget, stdio: 'pipe' })
      console.log(chalk.green('✓ Codex runtime installed'))
      markStep(homeDir, checkpoint, 'plugin')
    } else { console.log(chalk.gray('Installing discord-filtered plugin...'))

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

    if (answers.runtime === 'codex') {
      console.log(chalk.gray('Installing the latest Matt Pocock skills for Codex...'))
      try {
        execSync(`bash "${resolve(dir, 'scripts/sync-codex-skills.sh')}"`, { stdio: 'inherit' })
      } catch {
        console.error(chalk.red('\nFATAL: Could not install mattpocock/skills for Codex.'))
        console.error(chalk.yellow('Check network/npm access, then resume `npx onkol setup`.'))
        process.exit(1)
      }
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

program
  .command('update')
  .description('Update plugin + scripts and restart workers with conversation history preserved')
  .option('--skip-update', 'Skip pulling latest npm package, just restart workers')
  .option('--dir <path>', 'Onkol install directory', '')
  .option('--runtime <provider>', 'Keep or switch runtime: claude|codex', '')
  .action(async (opts) => {
    // Find install directory
    let dir = opts.dir
    if (!dir) {
      // Try common locations
      const homeDir = process.env.HOME || ''
      const candidates = [
        resolve(homeDir, 'onkol'),
        resolve(homeDir, '.onkol'),
        '/opt/onkol',
      ]
      for (const c of candidates) {
        if (existsSync(resolve(c, 'config.json'))) { dir = c; break }
      }
    }
    if (!dir || !existsSync(resolve(dir, 'config.json'))) {
      console.log(chalk.red('Could not find Onkol install. Use --dir <path> to specify.'))
      process.exit(1)
    }

    const configPath = resolve(dir, 'config.json')
    const config = JSON.parse(readFileSync(configPath, 'utf-8'))
    const currentRuntime: AgentRuntime = config.runtime || 'claude'
    const targetRuntime = (opts.runtime || currentRuntime) as AgentRuntime
    if (!['claude', 'codex'].includes(targetRuntime)) {
      console.log(chalk.red('--runtime must be "claude" or "codex"'))
      process.exit(1)
    }
    const trackingPath = resolve(dir, 'workers/tracking.json')
    const initialTracking = existsSync(trackingPath)
      ? JSON.parse(readFileSync(trackingPath, 'utf-8'))
      : []
    const initiallyActive = initialTracking.filter((w: any) => w.status === 'active')
    if (targetRuntime !== currentRuntime && initiallyActive.length > 0) {
      console.log(chalk.red(`Cannot switch ${currentRuntime} → ${targetRuntime} with active workers.`))
      console.log(chalk.yellow('Dissolve the workers first; their channels and learnings need an explicit lifecycle decision.'))
      process.exit(1)
    }
    if (targetRuntime !== currentRuntime) {
      const backupPath = `${configPath}.pre-${targetRuntime}-${Date.now()}.bak`
      copyFileSync(configPath, backupPath)
      config.runtime = targetRuntime
      if (targetRuntime === 'codex') {
        config.codex ||= {
          home: resolve(process.env.HOME || '', '.codex'),
          model: null,
          reasoningEffort: 'high',
          autoCompactPercent: 80,
          wsPortBase: 18300,
          syncMattPocockSkills: true,
        }
      }
      writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 })
      console.log(chalk.green(`Runtime switched to ${targetRuntime}; backup: ${backupPath}`))
    }
    const nodeName = config.nodeName
    console.log(chalk.bold('=== Onkol Update & Restart ==='))
    console.log(chalk.gray(`Node: ${nodeName}`))
    console.log(chalk.gray(`Install dir: ${dir}`))
    console.log('')

    // Step 1: Update files
    if (!opts.skipUpdate) {
      console.log(chalk.cyan('[1/3] Updating files from npm package...'))
      try {
        // Find where this CLI is running from — that's the latest package
        // __dirname is dist/cli/, so pkgRoot is two levels up (dist/cli -> dist -> package root)
        const pkgRoot = resolve(__dirname, '../..')
        const { readdirSync, chmodSync } = await import('fs')

        // Try src/plugin first (has .ts files), then dist/plugin (.js files)
        let pluginUpdated = false
        for (const candidate of ['src/plugin', 'dist/plugin']) {
          const pluginSrc = resolve(pkgRoot, candidate)
          if (existsSync(pluginSrc)) {
            const pluginDest = resolve(dir, 'plugins/discord-filtered')
            mkdirSync(pluginDest, { recursive: true })
            for (const f of readdirSync(pluginSrc)) {
              if (f.endsWith('.ts') || f.endsWith('.js')) {
                copyFileSync(resolve(pluginSrc, f), resolve(pluginDest, f))
              }
            }
            console.log(chalk.green(`  ✓ Plugin files updated (from ${candidate})`))
            pluginUpdated = true
            break
          }
        }
        if (!pluginUpdated) {
          console.log(chalk.yellow(`  ⚠ No plugin source found in package (looked in ${pkgRoot})`))
        }

        // Copy scripts
        const scriptsSrc = resolve(pkgRoot, 'scripts')
        if (existsSync(scriptsSrc)) {
          mkdirSync(resolve(dir, 'scripts'), { recursive: true })
          let count = 0
          for (const f of readdirSync(scriptsSrc)) {
            if (f.endsWith('.sh')) {
              copyFileSync(resolve(scriptsSrc, f), resolve(dir, 'scripts', f))
              chmodSync(resolve(dir, 'scripts', f), 0o755)
              count++
            }
          }
          console.log(chalk.green(`  ✓ ${count} scripts updated`))
        } else {
          console.log(chalk.yellow(`  ⚠ No scripts dir found at ${scriptsSrc}`))
        }

        // Install the Codex runtime without touching config, workers, knowledge,
        // registry, or service discovery files.
        if (targetRuntime === 'codex') {
          const runtimeSrc = resolve(pkgRoot, 'runtime/codex')
          const runtimeDest = resolve(dir, 'runtime/codex')
          if (!existsSync(runtimeSrc)) throw new Error(`Codex runtime missing from package: ${runtimeSrc}`)
          mkdirSync(runtimeDest, { recursive: true })
          for (const f of readdirSync(runtimeSrc)) {
            if (f.endsWith('.js') || f === 'package.json' || f === 'package-lock.json') {
              copyFileSync(resolve(runtimeSrc, f), resolve(runtimeDest, f))
            }
          }
          execSync('npm install --omit=dev', { cwd: runtimeDest, stdio: 'pipe' })
          const agentsPath = resolve(dir, 'AGENTS.md')
          if (!existsSync(agentsPath)) {
            writeFileSync(agentsPath, renderOrchestratorClaude({
              nodeName,
              maxWorkers: config.maxWorkers || 3,
              runtime: 'codex',
            }))
          }
          console.log(chalk.green('  ✓ Codex runtime updated'))
        }
      } catch (err) {
        console.log(chalk.yellow(`  ⚠ Update failed: ${err instanceof Error ? err.message : err}`))
        console.log(chalk.yellow('  Continuing with restart...'))
      }
    } else {
      console.log(chalk.gray('[1/3] Skipping update (--skip-update)'))
    }

    if (targetRuntime === 'codex' && !opts.skipUpdate) {
      try {
        execSync(`bash "${resolve(dir, 'scripts/sync-codex-skills.sh')}"`, { stdio: 'inherit' })
      } catch {
        console.error(chalk.red('\nFATAL: Onkol was updated, but mattpocock/skills could not be synchronized.'))
        console.error(chalk.yellow('Existing sessions were left running. Fix network/npm access and run update again.'))
        process.exit(1)
      }
    }
    console.log('')

    // Step 2: Find active workers and their session IDs
    console.log(chalk.cyan('[2/3] Dissolving active workers...'))
    const tracking = existsSync(trackingPath)
      ? JSON.parse(readFileSync(trackingPath, 'utf-8'))
      : []
    const active = tracking.filter((w: any) => w.status === 'active')
    if (targetRuntime === 'codex') {
      console.log(chalk.cyan('[2/3] Restarting Codex sessions in place...'))
      const sessionName = `onkol-${nodeName}`
      const sameRuntime = currentRuntime === 'codex'
      if (sameRuntime) {
        for (const worker of active) {
          try {
            execSync(`bash "${resolve(dir, 'scripts/restart-codex-session.sh')}" --name "${worker.name}"`, { stdio: 'pipe' })
            console.log(chalk.green(`  ✓ ${worker.name} restarted in its existing channel`))
          } catch (err) {
            console.log(chalk.red(`  ✗ Failed to restart ${worker.name}: ${err instanceof Error ? err.message : err}`))
          }
        }
        try {
          execSync(`bash "${resolve(dir, 'scripts/start-codex-orchestrator.sh')}" --respawn`, { stdio: 'pipe' })
          console.log(chalk.green('  ✓ Orchestrator restarted'))
        } catch (err) {
          console.log(chalk.red(`  ✗ Failed to restart orchestrator: ${err instanceof Error ? err.message : err}`))
          try {
            execSync(`bash "${resolve(dir, 'scripts/start-codex-orchestrator.sh')}"`, { stdio: 'pipe' })
            console.log(chalk.green('  ✓ Orchestrator started'))
          } catch { /* original error is already reported */ }
        }
      } else {
        try { execSync(`tmux kill-session -t "${sessionName}"`, { stdio: 'pipe' }) } catch { /* not running */ }
        execSync(`bash "${resolve(dir, 'scripts/start-codex-orchestrator.sh')}"`, { stdio: 'pipe' })
        console.log(chalk.green('  ✓ Existing deployment migrated and Codex orchestrator started'))
      }
      console.log(chalk.green.bold('\n✓ Codex update complete. Configuration and state were preserved.'))
      return
    }
    if (active.length === 0) {
      console.log(chalk.gray('  No active workers.'))
      console.log(chalk.green.bold('\n✓ Update complete. No workers to restart.'))
      return
    }

    interface WorkerInfo { name: string; workDir: string; intent: string; sessionId: string }
    const workers: WorkerInfo[] = []

    for (const w of active) {
      // Find session ID: look in ~/.claude/projects/<encoded-path>/
      const encoded = '-' + w.workDir.replace(/^\//,'').replace(/\//g, '-')
      const sessionDir = resolve(process.env.HOME || '', '.claude/projects', encoded)
      let sessionId = ''
      try {
        const { readdirSync, statSync } = await import('fs')
        const jsonls = readdirSync(sessionDir)
          .filter((f: string) => f.endsWith('.jsonl'))
          .map((f: string) => ({ name: f, mtime: statSync(resolve(sessionDir, f)).mtimeMs }))
          .sort((a: any, b: any) => a.mtime - b.mtime)
        if (jsonls.length > 0) {
          sessionId = jsonls[jsonls.length - 1].name.replace('.jsonl', '')
        }
      } catch { /* session dir may not exist */ }

      workers.push({ name: w.name, workDir: w.workDir, intent: w.intent, sessionId })
      console.log(chalk.gray(`  ${w.name} → session: ${sessionId || 'none'}`))
    }
    console.log('')

    // Dissolve
    for (const w of workers) {
      try {
        execSync(`bash "${resolve(dir, 'scripts/dissolve-worker.sh')}" --name "${w.name}"`, { stdio: 'pipe' })
        console.log(chalk.gray(`  ✓ ${w.name} dissolved`))
      } catch (err) {
        console.log(chalk.yellow(`  ⚠ Failed to dissolve ${w.name}: ${err instanceof Error ? err.message : err}`))
      }
    }
    console.log('')

    // Step 3: Respawn with --resume
    console.log(chalk.cyan('[3/3] Respawning workers with --resume...'))
    for (const w of workers) {
      const resumeArg = w.sessionId ? `--resume ${w.sessionId}` : ''
      const cmd = `bash "${resolve(dir, 'scripts/spawn-worker.sh')}" \
        --name "${w.name}" \
        --dir "${w.workDir}" \
        --task "Continue the previous work. Check your conversation history for context." \
        --intent "${w.intent}" \
        ${resumeArg}`
      try {
        const output = execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] })
        console.log(chalk.green(`  ✓ ${w.name} respawned${w.sessionId ? ' (resumed)' : ''}`))
        if (output.trim()) console.log(chalk.gray(`    ${output.trim()}`))
      } catch (err: any) {
        console.log(chalk.red(`  ✗ Failed to spawn ${w.name}`))
        if (err.stderr) console.log(chalk.red(`    stderr: ${err.stderr.toString().trim()}`))
        if (err.stdout) console.log(chalk.gray(`    stdout: ${err.stdout.toString().trim()}`))
      }
      // Small delay to avoid Discord rate limits
      await new Promise(r => setTimeout(r, 2000))
    }

    console.log(chalk.green.bold(`\n✓ Update complete. ${workers.length} worker(s) restarted.`))
  })

program.parse()
