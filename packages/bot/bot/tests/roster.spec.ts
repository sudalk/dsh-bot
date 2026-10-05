import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import BotRegistry, { BotId } from '../src/index.ts'
import { botPersona } from '../src/identity.ts'
import {
  BOT_ROSTER_DESCRIPTION_MAX_CHARS,
  BOT_ROSTER_PERSONA_DESCRIPTION_MAX_CHARS,
  BOT_ROSTER_PERSONA_MAX_ENTRIES,
  installBotRosterTool,
  renderRosterPreamble,
} from '../src/roster.ts'
import type { BotRosterHost, BotTeammate } from '../src/roster.ts'
import type { Bot } from '../src/types.ts'

const teammate = (name: string, description = `${name} 的职责`): BotTeammate => ({ name, description })

describe('roster preamble', () => {
  it('is absent without teammates, so a one-Bot roster pays no context cost', () => {
    expect(renderRosterPreamble([])).toBeUndefined()
    expect(botPersona({ name: 'A', description: 'r' })).not.toContain('名册')
  })

  it('names each teammate with its job and points at the handoff tool', () => {
    const text = renderRosterPreamble([teammate('代码审查员', '审查每个 diff。')])
    expect(text).toContain('「代码审查员」')
    expect(text).toContain('审查每个 diff。')
    expect(text).toContain('handoff_to_bot')
  })

  it('bounds each description and caps the list, naming the overflow count', () => {
    const long = renderRosterPreamble([teammate('A', 'x'.repeat(BOT_ROSTER_PERSONA_DESCRIPTION_MAX_CHARS + 50))])
    expect(long).toContain('…')
    expect(long?.length).toBeLessThan(BOT_ROSTER_PERSONA_DESCRIPTION_MAX_CHARS + 200)

    const many = Array.from({ length: BOT_ROSTER_PERSONA_MAX_ENTRIES + 2 }, (_, index) => teammate(`B${index}`))
    const capped = renderRosterPreamble(many)
    expect(capped).toContain(`B${BOT_ROSTER_PERSONA_MAX_ENTRIES - 1}`)
    expect(capped).not.toContain(`B${BOT_ROSTER_PERSONA_MAX_ENTRIES}`)
    expect(capped).toContain('此外还有 2 位队友')
    expect(capped).toContain('list_bots')
  })

  it('reaches the persona as its own block', () => {
    const persona = botPersona({ name: '测试助手', description: '负责测试。' }, [teammate('代码审查员')])
    expect(persona).toContain('Your standing role and rules:\n负责测试。')
    expect(persona).toContain('「代码审查员」')
  })
})

describe('list_bots tool', () => {
  function harness(roster: readonly Bot[], caller: Bot | null = roster[0] ?? null) {
    let captured: {
      name: string
      execute: (args: unknown, exec: { agent: unknown }) => Promise<unknown>
    } | undefined
    const host: BotRosterHost = {
      byConversation: () => caller ?? undefined,
      list: () => roster,
    }
    const tools = {
      register: (tool: unknown) => {
        captured = tool as typeof captured
        return () => {}
      },
    }
    const agent = {
      id: 'session-self',
      ctx: { get: (name: string) => (name === 'tools' ? tools : undefined) },
    }
    const dispose = installBotRosterTool(agent as never, host)
    if (captured === undefined) throw new Error('roster tool was not registered')
    return { tool: captured, dispose }
  }

  const bot = (id: string, name: string, description = ''): Bot => ({
    id: BotId(id),
    name,
    description,
    preset: 'standard',
    avatar: undefined,
    permission: undefined,
    workspaceId: 'ws-home' as never,
    conversationId: undefined,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    update: async () => {},
    adoptConversation: async sessionId => sessionId,
    ensureConversation: async () => 's' as never,
  })

  it('lists every teammate except the caller, describing each with its job', async () => {
    const self = bot('b1', '测试助手', '负责测试。')
    const other = bot('b2', '代码审查员', '审查每个 diff。')
    const { tool } = harness([self, other], self)
    const value = await tool.execute({}, { agent: { id: 'session-self' } })
    expect(value).toEqual({ bots: [{ name: '代码审查员', description: '审查每个 diff。' }] })
  })

  it('bounds long descriptions and refuses to run outside a Bot conversation', async () => {
    const self = bot('b1', '测试助手')
    const other = bot('b2', '代码审查员', 'x'.repeat(BOT_ROSTER_DESCRIPTION_MAX_CHARS + 50))
    const { tool } = harness([self, other], self)
    const value = await tool.execute({}, { agent: { id: 'session-self' } }) as {
      bots: Array<{ description: string }>
    }
    const first = value.bots[0]
    expect(first?.description.endsWith('…')).toBe(true)
    expect(first?.description.length ?? 0).toBeLessThanOrEqual(BOT_ROSTER_DESCRIPTION_MAX_CHARS)

    const stranger = harness([self], null)
    await expect(stranger.tool.execute({}, { agent: { id: 'other' } }))
      .rejects.toThrow('only inside a Bot conversation')
  })

  it('requires a calling Agent and a tools service', async () => {
    const { tool } = harness([bot('b1', 'A')])
    await expect(tool.execute({}, { agent: undefined }))
      .rejects.toThrow('requires a calling Agent')
    const bare = installBotRosterTool({
      id: 's', ctx: { get: () => undefined },
    } as never, {
      byConversation: () => undefined,
      list: () => [],
    })
    expect(bare).toBeUndefined()
  })
})

describe('registry roster awareness', () => {
  it('composes the persona and both tools for a Bot conversation, teammate list included', async () => {
    const ctx = new Context()
    await ctx.plugin(Storage)
    ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
    const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
    ctx.storage.mount('domain', facility)
    ctx.provide('storageDomain', facility)

    const sections: Array<{ name: string; text: string }> = []
    const registered: Array<{ name: string; execute: (...args: unknown[]) => Promise<unknown> }> = []
    const agent = {
      id: 's-1',
      session: { id: 's-1' },
      ctx: {
        get: (name: string) => name === 'systemPrompt'
          ? { section: (spec: { name: string; text: string }) => { sections.push(spec) }, getSectionOrder: () => 0 }
          : name === 'tools'
            ? { register: (tool: unknown) => { registered.push(tool as typeof registered[number]); return () => {} } }
            : undefined,
      },
    }
    ctx.provide('agents', { get: () => agent } as never)
    ctx.provide('sessionController', { create: async () => ({ sessionId: 's-1' }) } as never)
    ctx.provide('workspaceRegistry', { get: (id: WorkspaceId) => ({ id }) } as never)
    await ctx.plugin(BotRegistry)
    const registry = ctx.bots

    const tester = await registry.create({
      name: '测试助手', description: '负责测试。', preset: 'standard', workspaceId: WorkspaceId('ws-1'),
    })
    await registry.create({
      name: '代码审查员', description: '审查每个 diff。', preset: 'standard', workspaceId: WorkspaceId('ws-1'),
    })
    await tester.ensureConversation()

    const persona = sections.find(section => section.name === 'deployment:persona-prefix')
    expect(persona?.text).toContain('「代码审查员」')
    expect(registered.map(tool => tool.name).sort()).toEqual(['ask_teammate', 'handoff_to_bot', 'list_bots'])

    const rosterTool = registered.find(tool => tool.name === 'list_bots')
    await expect(rosterTool?.execute({}, { agent }))
      .resolves.toEqual({ bots: [{ name: '代码审查员', description: '审查每个 diff。' }] })
  })
})
