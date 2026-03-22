import inquirer from 'inquirer'

export interface SetupAnswers {
  installDir: string
  nodeName: string
  botToken: string
  guildId: string
  discordUserId: string
  registryPath: string | null
  registryMode: 'import' | 'skip'
  serviceMode: 'import' | 'auto' | 'skip'
  serviceSummaryPath: string | null
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
      type: 'list',
      name: 'serviceMode',
      message: 'Service summary for this VM?',
      choices: [
        { name: 'Auto-discover (scan for running services)', value: 'auto' },
        { name: 'Import from file', value: 'import' },
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
    serviceSummaryPath: answers.serviceSummaryPath || null,
  } as SetupAnswers
}
