import inquirer from 'inquirer'
import chalk from 'chalk'

export type AgentRuntime = 'claude' | 'codex'

export interface SetupAnswers {
  runtime: AgentRuntime
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
  watchdogProvider: 'openrouter' | 'gemini' | 'custom' | 'skip'
  watchdogModel: string | null
  watchdogApiKey: string | null
  watchdogApiUrl: string | null
  codexHome: string | null
  codexModel: string | null
  codexReasoningEffort: 'low' | 'medium' | 'high' | 'xhigh' | null
  codexAutoCompactPercent: number
}

export async function chooseRuntime(defaultRuntime: AgentRuntime = 'codex'): Promise<AgentRuntime> {
  const { runtime } = await inquirer.prompt([{
    type: 'list',
    name: 'runtime',
    message: 'Which agent runtime should this node use?',
    choices: [
      { name: 'Codex (ChatGPT subscription or API login)', value: 'codex' },
      { name: 'Claude Code (existing Onkol behavior)', value: 'claude' },
    ],
    default: defaultRuntime,
  }])
  return runtime as AgentRuntime
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
      ${chalk.gray('✓ Pin Messages  (needed to pin the session status card)')}
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

export async function runSetupPrompts(homeDir: string, runtime: AgentRuntime): Promise<SetupAnswers> {
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
        { name: 'Write a prompt — tell the agent what to find', value: 'prompt' },
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
      message: 'Describe what the agent should find for the registry (secrets, endpoints, ports):',
      when: (a: Record<string, unknown>) => a.registryMode === 'prompt',
    },
    {
      type: 'list',
      name: 'serviceMode',
      message: 'Service summary for this VM?',
      choices: [
        { name: 'Auto-discover (scan for running services)', value: 'auto' },
        { name: 'Import from file', value: 'import' },
        { name: 'Write a prompt — tell the agent what to discover', value: 'prompt' },
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
      message: 'Describe what the agent should discover about services on this VM:',
      when: (a: Record<string, unknown>) => a.serviceMode === 'prompt',
    },
    {
      type: 'list',
      name: 'claudeMdMode',
      message: `Want to describe this project in plain language? ${runtime === 'codex' ? 'Codex will create AGENTS.md instructions.' : 'Claude will create CLAUDE.md instructions.'}`,
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
      when: () => runtime === 'claude',
    },
    {
      type: 'input',
      name: 'codexHome',
      message: 'Codex home containing this account login:',
      default: `${homeDir}/.codex`,
      when: () => runtime === 'codex',
    },
    {
      type: 'input',
      name: 'codexModel',
      message: 'Codex model (leave blank to use account default):',
      default: '',
      when: () => runtime === 'codex',
    },
    {
      type: 'list',
      name: 'codexReasoningEffort',
      message: 'Codex reasoning effort:',
      choices: ['medium', 'high', 'xhigh', 'low'],
      default: 'high',
      when: () => runtime === 'codex',
    },
    {
      type: 'number',
      name: 'codexAutoCompactPercent',
      message: 'Automatically compact idle Codex sessions at context %:',
      default: 80,
      when: () => runtime === 'codex',
    },
    {
      type: 'list',
      name: 'watchdogProvider',
      message: 'Worker watchdog LLM (monitors workers, nudges if stuck/silent):',
      choices: [
        { name: 'OpenRouter (recommended — use any model via openrouter.ai)', value: 'openrouter' },
        { name: 'Google Gemini (direct API)', value: 'gemini' },
        { name: 'Custom OpenAI-compatible endpoint', value: 'custom' },
        { name: 'Skip (disable LLM watchdog)', value: 'skip' },
      ],
    },
    {
      type: 'list',
      name: 'watchdogModel',
      message: 'Watchdog model:',
      choices: (a: Record<string, unknown>) => {
        const base = [
          { name: 'google/gemini-2.5-flash (fast, cheap)', value: 'google/gemini-2.5-flash' },
          { name: 'google/gemini-2.0-flash-001 (fast, cheap)', value: 'google/gemini-2.0-flash-001' },
          { name: 'anthropic/claude-haiku (fast)', value: 'anthropic/claude-3-5-haiku-20241022' },
          { name: 'Custom — enter model ID', value: '__custom__' },
        ]
        if (a.watchdogProvider === 'gemini') {
          return [
            { name: 'gemini-2.5-flash-preview-05-20 (recommended)', value: 'gemini-2.5-flash-preview-05-20' },
            { name: 'gemini-2.0-flash', value: 'gemini-2.0-flash' },
            { name: 'Custom — enter model ID', value: '__custom__' },
          ]
        }
        return base
      },
      when: (a: Record<string, unknown>) => a.watchdogProvider !== 'skip',
    },
    {
      type: 'input',
      name: 'watchdogModelCustom',
      message: 'Enter model ID:',
      when: (a: Record<string, unknown>) => a.watchdogProvider !== 'skip' && a.watchdogModel === '__custom__',
    },
    {
      type: 'password',
      name: 'watchdogApiKey',
      message: (a: Record<string, unknown>) => {
        if (a.watchdogProvider === 'openrouter') return 'OpenRouter API key (sk-or-...):'
        if (a.watchdogProvider === 'gemini') return 'Google Gemini API key:'
        return 'API key:'
      },
      mask: '*',
      when: (a: Record<string, unknown>) => a.watchdogProvider !== 'skip',
    },
    {
      type: 'input',
      name: 'watchdogApiUrl',
      message: 'API base URL (OpenAI-compatible, e.g. https://api.example.com/v1/chat/completions):',
      when: (a: Record<string, unknown>) => a.watchdogProvider === 'custom',
    },
  ])

  const answers = { ...preDiscordAnswers, ...discordAndRestAnswers }

  // Resolve custom model selection
  const watchdogModel = answers.watchdogModel === '__custom__'
    ? (answers.watchdogModelCustom || null)
    : (answers.watchdogModel || null)

  return {
    ...answers,
    runtime,
    plugins: answers.plugins || [],
    registryPath: answers.registryPath || null,
    registryPrompt: answers.registryPrompt || null,
    serviceSummaryPath: answers.serviceSummaryPath || null,
    servicesPrompt: answers.servicesPrompt || null,
    claudeMdPrompt: answers.claudeMdPrompt || null,
    watchdogModel,
    watchdogApiKey: answers.watchdogApiKey || null,
    watchdogApiUrl: answers.watchdogApiUrl || null,
    codexHome: answers.codexHome || null,
    codexModel: answers.codexModel || null,
    codexReasoningEffort: answers.codexReasoningEffort || null,
    codexAutoCompactPercent: Number(answers.codexAutoCompactPercent || 80),
  } as SetupAnswers
}
