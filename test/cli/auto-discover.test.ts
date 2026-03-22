import { describe, it, expect } from 'bun:test'
import { parseDockerPs, parseSsOutput } from '../../src/cli/auto-discover'

describe('parseDockerPs', () => {
  it('parses docker ps output', () => {
    const output = `CONTAINER ID   IMAGE          PORTS                    NAMES
abc123         loyalty:v2     0.0.0.0:8080->8080/tcp   loyalty-bot
def456         postgres:15    0.0.0.0:5432->5432/tcp   postgres`

    const services = parseDockerPs(output)
    expect(services).toHaveLength(2)
    expect(services[0]).toEqual({ name: 'loyalty-bot', type: 'docker', port: '8080', image: 'loyalty:v2' })
    expect(services[1]).toEqual({ name: 'postgres', type: 'docker', port: '5432', image: 'postgres:15' })
  })

  it('returns empty array for no containers', () => {
    expect(parseDockerPs('CONTAINER ID   IMAGE   PORTS   NAMES\n')).toEqual([])
  })
})

describe('parseSsOutput', () => {
  it('parses ss listening ports', () => {
    const output = `State  Recv-Q Send-Q Local Address:Port  Peer Address:Port Process
LISTEN 0      128          *:3000           *:*     users:(("node",pid=1234,fd=5))
LISTEN 0      128          *:80             *:*     users:(("nginx",pid=5678,fd=6))`

    const services = parseSsOutput(output)
    expect(services).toHaveLength(2)
    expect(services[0]).toEqual({ name: 'node', type: 'process', port: '3000' })
    expect(services[1]).toEqual({ name: 'nginx', type: 'process', port: '80' })
  })
})
