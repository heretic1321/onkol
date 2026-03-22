import inquirer from 'inquirer'

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

export async function runSetupPrompts(homeDir: string): Promise<SetupAnswers> {
  const answers = await inquirer.prompt([
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

  return {
    ...answers,
    registryPath: answers.registryPath || null,
    registryPrompt: answers.registryPrompt || null,
    serviceSummaryPath: answers.serviceSummaryPath || null,
    servicesPrompt: answers.servicesPrompt || null,
    claudeMdPrompt: answers.claudeMdPrompt || null,
  } as SetupAnswers
}
