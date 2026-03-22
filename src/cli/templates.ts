import Handlebars from 'handlebars'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const TEMPLATES_DIR = resolve(__dirname, '../../templates')

function loadTemplate(name: string): HandlebarsTemplateDelegate {
  const content = readFileSync(resolve(TEMPLATES_DIR, name), 'utf-8')
  return Handlebars.compile(content)
}

Handlebars.registerHelper('eq', (a: string, b: string) => a === b)

export function renderOrchestratorClaude(data: { nodeName: string; maxWorkers: number }): string {
  return loadTemplate('orchestrator-claude.md.hbs')(data)
}

export function renderSettings(data: { bashLogPath: string }): string {
  return loadTemplate('settings.json.hbs')(data)
}
