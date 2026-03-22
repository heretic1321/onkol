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

    // Build allowed users list from Discord user ID prompt
    const user = process.env.USER || 'root'
    const allowedUsers: string[] = []
    if (answers.discordUserId.trim()) {
      allowedUsers.push(answers.discordUserId.trim())
    }

    // --- CRITICAL: Create Discord category and orchestrator channel ---
    console.log(chalk.gray('Creating Discord category and channel...'))
    let category: { id: string; name: string }
    let orchChannel: { id: string; name: string }
    try {
      category = await createCategory(answers.botToken, answers.guildId, answers.nodeName)
      orchChannel = await createChannel(answers.botToken, answers.guildId, 'orchestrator', category.id)
    } catch (err) {
      console.error(chalk.red(`\nFATAL: Could not create Discord category/channel.`))
      console.error(chalk.red(`${err instanceof Error ? err.message : err}`))
      console.error(chalk.red('\nCheck that:'))
      console.error(chalk.red('  1. Your bot token is correct'))
      console.error(chalk.red('  2. Your server (guild) ID is correct'))
      console.error(chalk.red('  3. The bot has been invited to the server with "Manage Channels" permission'))
      process.exit(1)
    }
    console.log(chalk.green('✓ Discord category and #orchestrator channel created'))

    // Write config.json
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

    // Handle setup prompts
    const pendingPrompts: Array<{ target: string; prompt: string; status: string }> = []
    if (answers.registryPrompt) {
      pendingPrompts.push({ target: 'registry.json', prompt: answers.registryPrompt, status: 'pending' })
    }
    if (answers.servicesPrompt) {
      pendingPrompts.push({ target: 'services.md', prompt: answers.servicesPrompt, status: 'pending' })
    }
    if (answers.claudeMdPrompt) {
      pendingPrompts.push({ target: 'CLAUDE.md', prompt: answers.claudeMdPrompt, status: 'pending' })
    }
    if (pendingPrompts.length > 0) {
      writeFileSync(resolve(dir, 'setup-prompts.json'), JSON.stringify({ pending: pendingPrompts }, null, 2))
    }

    // --- CRITICAL: Copy scripts ---
    const requiredScripts = ['spawn-worker.sh', 'dissolve-worker.sh', 'list-workers.sh', 'check-worker.sh', 'healthcheck.sh', 'start-orchestrator.sh']
    const scriptsSource = resolve(__dirname, '../../scripts')
    console.log(chalk.gray('Copying scripts...'))
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

    // --- CRITICAL: Copy plugin source ---
    // Look for .ts source files first (for bun), fall back to .js compiled files
    const pluginFiles = ['index', 'mcp-server', 'discord-client', 'message-batcher']
    const pluginSourceDir = resolve(__dirname, '../plugin')
    const projectSrcDir = resolve(__dirname, '../../src/plugin')
    console.log(chalk.gray('Installing discord-filtered plugin...'))

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
      process.exit(1)
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
          writeFileSync(resolve(timerDir, 'onkol-healthcheck.service'), `[Unit]\nDescription=Onkol healthcheck\n[Service]\nType=oneshot\nExecStart=${healthcheckPath}\n`)
          writeFileSync(resolve(timerDir, 'onkol-healthcheck.timer'), `[Unit]\nDescription=Onkol healthcheck every 5min\n[Timer]\nOnBootSec=2min\nOnUnitActiveSec=5min\n[Install]\nWantedBy=timers.target\n`)
          writeFileSync(resolve(timerDir, 'onkol-cleanup.service'), `[Unit]\nDescription=Onkol archive cleanup\n[Service]\nType=oneshot\nExecStart=/usr/bin/find ${resolve(dir, 'workers/.archive')} -maxdepth 1 -mtime +30 -exec rm -rf {} \\;\n`)
          writeFileSync(resolve(timerDir, 'onkol-cleanup.timer'), `[Unit]\nDescription=Onkol archive cleanup daily\n[Timer]\nOnCalendar=*-*-* 04:00:00\n[Install]\nWantedBy=timers.target\n`)
          execSync('systemctl --user daemon-reload', { stdio: 'pipe' })
          execSync('systemctl --user enable --now onkol-healthcheck.timer', { stdio: 'pipe' })
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
    if (pendingPrompts.length > 0) {
      console.log(chalk.cyan('\nPending setup prompts saved. On first boot, the orchestrator will:'))
      for (const p of pendingPrompts) {
        console.log(chalk.cyan(`  - Generate ${p.target} from your ${p.target === 'CLAUDE.md' ? 'description' : 'prompt'}`))
      }
    }

    // Start orchestrator
    console.log(chalk.gray('\nStarting orchestrator...'))
    try {
      execSync(`bash "${resolve(dir, 'scripts/start-orchestrator.sh')}"`, { stdio: 'pipe' })
      console.log(chalk.green(`✓ Orchestrator started in tmux session "onkol-${answers.nodeName}"`))
    } catch (err) {
      console.log(chalk.yellow(`⚠ Could not start orchestrator automatically.`))
      console.log(chalk.yellow(`  Start manually: ${dir}/scripts/start-orchestrator.sh`))
    }

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
