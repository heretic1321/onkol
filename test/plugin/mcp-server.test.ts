import { describe, it, expect } from 'bun:test'
import { createMcpServer } from '../../src/plugin/mcp-server'

describe('createMcpServer', () => {
  it('creates server with claude/channel capability', () => {
    const server = createMcpServer()
    expect(server).toBeDefined()
  })

  it('declares reply and reply_with_file tools', async () => {
    const server = createMcpServer()
    const tools = await server.listTools()
    const toolNames = tools.map((t: any) => t.name)
    expect(toolNames).toContain('reply')
    expect(toolNames).toContain('reply_with_file')
  })
})
