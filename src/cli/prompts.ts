import inquirer from 'inquirer'
import chalk from 'chalk'

export interface SetupAnswers {
  installDir: string
  nodeName: string
  botToken: string
  guildId: string
  discordUserId: string
  registryPath: string | null
  registryMode: 'import' | 'prompt' | 'skip'
  registryPrompt: string | null
  serviceMode: 'import' | 'auto' | 'prompt' | 'skip'
  serviceSummaryPath: string | null
  servicesPrompt: string | null
  claudeMdMode: 'prompt' | 'skip'
  claudeMdPrompt: string | null
  plugins: string[]
}

function printDiscordBotGuide(): void {
  const separator = '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
  console.log(`
${separator}
  ${chalk.bold('How to create a Discord bot for Onkol')}
${separator}

${chalk.bold('Step 1: Create a Discord Application')}
  → Go to ${chalk.cyan('https://discord.com/developers/applications')}
  → Click "New Application"
  → Name it (e.g., "onkol-bot" or your node name)
  → Click "Create"

${chalk.bold('Step 2: Create the Bot & Get Token')}
  → In your application, click "Bot" in the left sidebar
  → Click "Reset Token"
  → Copy the token — you'll need it in a moment
  → ${chalk.yellow('IMPORTANT: You can only see the token once. Save it.')}

${chalk.bold('Step 3: Enable Required Intents')}
  → Still on the Bot page, scroll down to "Privileged Gateway Intents"
  → Enable: "Message Content Intent"
  → Click "Save Changes"

${chalk.bold('Step 4: Invite the Bot to Your Server')}
  → Click "OAuth2" in the left sidebar
  → Click "URL Generator"
  → Under "Scopes", check: bot
  → Under "Bot Permissions", check:
      ${chalk.gray('✓ View Channels')}
      ${chalk.gray('✓ Send Messages')}
      ${chalk.gray('✓ Send Messages in Threads')}
      ${chalk.gray('✓ Read Message History')}
      ${chalk.gray('✓ Attach Files')}
      ${chalk.gray('✓ Add Reactions')}
      ${chalk.gray('✓ Manage Channels  (needed to create/delete worker channels)')}
  → Copy the generated URL at the bottom
  → Open it in your browser
  → Select your Discord server and click "Authorize"

${chalk.bold('Step 5: Get Your Server (Guild) ID')}
  → In Discord, go to Settings → Advanced → Enable "Developer Mode"
  → Right-click your server name → "Copy Server ID"
  → You'll need this in the next question

${chalk.bold('Step 6: Get Your Discord User ID')}
  → In Discord, right-click your username → "Copy User ID"
  → You'll need this to whitelist yourself
${separator}
`)
}

export async function runSetupPrompts(homeDir: string): Promise<SetupAnswers> {
  const preDiscordAnswers = await inquirer.prompt([
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
      type: 'list',
      name: 'botTokenHelp',
      message: 'Do you have a Discord bot token ready?',
      choices: [
        { name: 'Yes, I have my token', value: 'ready' },
        { name: 'No, show me how to create one', value: 'help' },
      ],
    },
  ])

  if (preDiscordAnswers.botTokenHelp === 'help') {
    printDiscordBotGuide()
  }

  const discordAndRestAnswers = await inquirer.prompt([
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
      type: 'input',
      name: 'discordUserId',
      message: 'Your Discord user ID (right-click your name > Copy User ID):',
    },
    {
      type: 'list',
      name: 'registryMode',
      message: 'Do you have a registry file for this VM? (secrets, endpoints, ports)',
      choices: [
        { name: 'Yes, import from file', value: 'import' },
        { name: 'Write a prompt — tell Claude what to find', value: 'prompt' },
        { name: 'Skip for now', value: 'skip' },
      ],
    },
    {
      type: 'input',
      name: 'registryPath',
      message: 'Path to registry file:',
      when: (a: Record<string, unknown>) => a.registryMode === 'import',
    },
    {
      type: 'input',
      name: 'registryPrompt',
      message: 'Describe what Claude should find for the registry (secrets, endpoints, ports):',
      when: (a: Record<string, unknown>) => a.registryMode === 'prompt',
    },
    {
      type: 'list',
      name: 'serviceMode',
      message: 'Service summary for this VM?',
      choices: [
        { name: 'Auto-discover (scan for running services)', value: 'auto' },
        { name: 'Import from file', value: 'import' },
        { name: 'Write a prompt — tell Claude what to discover', value: 'prompt' },
        { name: 'Skip for now', value: 'skip' },
      ],
    },
    {
      type: 'input',
      name: 'serviceSummaryPath',
      message: 'Path to service summary file:',
      when: (a: Record<string, unknown>) => a.serviceMode === 'import',
    },
    {
      type: 'input',
      name: 'servicesPrompt',
      message: 'Describe what Claude should discover about services on this VM:',
      when: (a: Record<string, unknown>) => a.serviceMode === 'prompt',
    },
    {
      type: 'list',
      name: 'claudeMdMode',
      message: 'Want to describe this project in plain language? Claude will convert it to a structured CLAUDE.md.',
      choices: [
        { name: 'Yes, write a description', value: 'prompt' },
        { name: 'Skip (use default template)', value: 'skip' },
      ],
    },
    {
      type: 'input',
      name: 'claudeMdPrompt',
      message: 'Describe this project in plain language:',
      when: (a: Record<string, unknown>) => a.claudeMdMode === 'prompt',
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

  const answers = { ...preDiscordAnswers, ...discordAndRestAnswers }

  return {
    ...answers,
    registryPath: answers.registryPath || null,
    registryPrompt: answers.registryPrompt || null,
    serviceSummaryPath: answers.serviceSummaryPath || null,
    servicesPrompt: answers.servicesPrompt || null,
    claudeMdPrompt: answers.claudeMdPrompt || null,
  } as SetupAnswers
}
