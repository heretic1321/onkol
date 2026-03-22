import { execSync } from 'child_process'

export interface DiscoveredService {
  name: string
  type: 'docker' | 'pm2' | 'systemd' | 'process'
  port?: string
  image?: string
  status?: string
}

export function parseDockerPs(output: string): DiscoveredService[] {
  const lines = output.trim().split('\n').slice(1)
  return lines
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const parts = line.split(/\s{2,}/)
      const name = parts[parts.length - 1]?.trim()
      const image = parts[1]?.trim()
      const portsField = parts.find((p) => p.includes('->')) || ''
      const portMatch = portsField.match(/:(\d+)->/)
      return { name, type: 'docker' as const, port: portMatch?.[1], image }
    })
    .filter((s) => s.name)
}

export function parseSsOutput(output: string): DiscoveredService[] {
  const lines = output.trim().split('\n').slice(1)
  return lines
    .filter((line) => line.includes('LISTEN'))
    .map((line) => {
      const portMatch = line.match(/\*:(\d+)/)
      const processMatch = line.match(/\("([^"]+)"/)
      return {
        name: processMatch?.[1] || 'unknown',
        type: 'process' as const,
        port: portMatch?.[1],
      }
    })
    .filter((s) => s.port)
}

export function discoverServices(): DiscoveredService[] {
  const services: DiscoveredService[] = []

  try {
    const dockerOutput = execSync('docker ps --format "table {{.ID}}\\t{{.Image}}\\t{{.Ports}}\\t{{.Names}}"', { encoding: 'utf-8', timeout: 5000 })
    services.push(...parseDockerPs(dockerOutput))
  } catch { /* docker not available */ }

  try {
    const ssOutput = execSync('ss -tlnp 2>/dev/null', { encoding: 'utf-8', timeout: 5000 })
    const processServices = parseSsOutput(ssOutput)
    const dockerPorts = new Set(services.map((s) => s.port))
    services.push(...processServices.filter((s) => !dockerPorts.has(s.port)))
  } catch { /* ss not available */ }

  return services
}

export function formatServicesMarkdown(services: DiscoveredService[]): string {
  if (services.length === 0) return 'No services discovered.\n'
  let md = '## Discovered Services\n\n'
  for (const s of services) {
    md += `- **${s.name}** (${s.type})`
    if (s.port) md += ` on port ${s.port}`
    if (s.image) md += ` — image: ${s.image}`
    md += '\n'
  }
  return md
}
