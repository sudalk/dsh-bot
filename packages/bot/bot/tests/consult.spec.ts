import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import BotRegistry, { BotId } from '../src/index.ts'
import {
  BOT_CONSULT_MAX_ROUNDS,
  BOT_CONSULT_QUESTION_MAX_CHARS,
  installBotConsultTool,
  renderConsultAnswerFrame,
  renderConsultFrame,
} from '../src/consult.ts'
import type { BotConsultHost } from '../src/consult.ts'
import type { Bot } from '../src/types.ts'


/** Emit one session event through the untyped bus seam (stubs are not real Session objects). */
function fire(ctx: Context, session: unknown, event: unknown): void {
  (ctx.emit as (name: string, session: unknown, event: unknown) => void)('session/event', session, event)
}

const callerBot = bot('bot-a', '测试助手')
const targetBot = bot('bot-b', '代码审查员')
const thirdBot = bot('bot-c', '研究助手')

function bot(id: string, name: string): Bot {
  return {
    id: BotId(id),
    name,
    description: '',
    preset: 'standard',
    avatar: undefined,
    permission: undefined,
    workspaceId: 'ws-home' as never,
    conversationId: 'session-self' as never,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    update: async () => {},
    adoptConversation: async sessionId => sessionId,
    ensureConversation: async () => (await Promise.resolve('session-b')) as never,
  }
}

/** One consult-family delivery as the receiving conversation log carries it. */
function consultIn(kind: 'bot-consult' | 'bot-consult-answer', senderId: string, round: number) {
  return {
    type: 'user/message',
    data: {
      source: { kind, senderBotId: BotId(senderId), senderName: 'x', questionId: 'q-1', round },
    },
  }
}

/** Install the tool over a captured registration and a scripted host. */
function harness(history: readonly unknown[] = []) {
  let captured: {
    name: string
    execute: (args: { bot: string; question: string }, exec: { agent: unknown }) => Promise<unknown>
  } | undefined
  const deliverConsult = vi.fn(async () => {})
  const host: BotConsultHost = {
    byConversation: sessionId => (String(sessionId) === 'session-self' ? callerBot : undefined),
    byName: name => [callerBot, targetBot, thirdBot].find(candidate => candidate.name === name),
    rosterNames: () => [callerBot.name, targetBot.name, thirdBot.name],
    deliverConsult,
  }
  const tools = {
    register: (tool: unknown) => {
      captured = tool as typeof captured
      return () => {}
    },
  }
  const agent = {
    id: 'session-self',
    session: {
      inheritedEventCount: 0,
      snapshotEvents: () => history,
    },
    ctx: { get: (name: string) => (name === 'tools' ? tools : undefined) },
  }
  const dispose = installBotConsultTool(agent as never, host)
  if (captured === undefined) throw new Error('consult tool was not registered')
  return { tool: captured, deliverConsult, dispose, agent }
}

describe('consult frames', () => {
  it('names the asking teammate and keeps the question verbatim', () => {
    const frame = renderConsultFrame({ fromName: '测试助手', question: '这个改动风险如何？' })
    expect(frame).toContain('[队友咨询] 队友「测试助手」')
    expect(frame).toContain('这个改动风险如何？')
    expect(frame).toContain('会原样回传给他')
  })

  it('cuts an oversized question with an ellipsis', () => {
    const frame = renderConsultFrame({ fromName: 'A', question: 'x'.repeat(BOT_CONSULT_QUESTION_MAX_CHARS + 400) })
    expect(frame).toContain('…')
    expect(frame.length).toBeLessThan(BOT_CONSULT_QUESTION_MAX_CHARS + 400)
  })

  it('quotes question and answer back to the asker', () => {
    const frame = renderConsultAnswerFrame({ fromName: '代码审查员', question: '风险如何？', answer: '风险在并发写。' })
    expect(frame).toContain('[咨询回复] 队友「代码审查员」')
    expect(frame).toContain('你的问题：\n风险如何？')
    expect(frame).toContain('他的回答：\n风险在并发写。')
    expect(frame).toContain('咨询到此结束')
  })
})

describe('ask_teammate tool', () => {
  it('asks the named teammate at round 1 and reports it', async () => {
    const { tool, deliverConsult, agent } = harness()
    const result = await tool.execute({ bot: '代码审查员', question: '这个改动风险如何？' }, { agent })
    expect(result).toEqual({ teammate: '代码审查员', asked: true })
    expect(deliverConsult).toHaveBeenCalledWith(callerBot, targetBot, '这个改动风险如何？', 1)
  })

  it('rejects unknown names with the roster, self-targets, and blank questions', async () => {
    const { tool, deliverConsult, agent } = harness()
    await expect(tool.execute({ bot: '不存在', question: 'q' }, { agent }))
      .rejects.toThrow('available: 测试助手, 代码审查员, 研究助手')
    await expect(tool.execute({ bot: '测试助手', question: 'q' }, { agent }))
      .rejects.toThrow('cannot consult itself')
    await expect(tool.execute({ bot: '代码审查员', question: '   ' }, { agent }))
      .rejects.toThrow('must not be blank')
    expect(deliverConsult).not.toHaveBeenCalled()
  })

  it('grows the round from the consult that woke this conversation', async () => {
    const { tool, deliverConsult, agent } = harness([consultIn('bot-consult', 'bot-c', 1)])
    await tool.execute({ bot: '代码审查员', question: 'q' }, { agent })
    expect(deliverConsult).toHaveBeenCalledWith(callerBot, targetBot, 'q', 2)
  })

  it('refuses to ask back while the named teammate waits for an answer', async () => {
    const { tool, deliverConsult, agent } = harness([consultIn('bot-consult', 'bot-b', 1)])
    await expect(tool.execute({ bot: '代码审查员', question: 'q' }, { agent }))
      .rejects.toThrow('waiting for your answer')
    expect(deliverConsult).not.toHaveBeenCalled()
  })

  it('stops a chain that already ran the round cap', async () => {
    const { tool, deliverConsult, agent } = harness([consultIn('bot-consult-answer', 'bot-c', BOT_CONSULT_MAX_ROUNDS)])
    await expect(tool.execute({ bot: '代码审查员', question: 'q' }, { agent }))
      .rejects.toThrow(`already ran ${BOT_CONSULT_MAX_ROUNDS} rounds`)
    expect(deliverConsult).not.toHaveBeenCalled()
  })

  it('requires a calling Agent and a tools service', async () => {
    const { tool } = harness()
    await expect(tool.execute({ bot: '代码审查员', question: 'q' }, { agent: undefined }))
      .rejects.toThrow('requires a calling Agent')
    const bare = installBotConsultTool({
      id: 's', session: {}, ctx: { get: () => undefined },
    } as never, {
      byConversation: () => undefined,
      byName: () => undefined,
      rosterNames: () => [],
      deliverConsult: async () => {},
    })
    expect(bare).toBeUndefined()
  })
})

describe('registry consultation reply routing', () => {
  /** Registry over two Bot conversations whose Agents record every followup. */
  async function harness() {
    const ctx = new Context()
    await ctx.plugin(Storage)
    ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
    const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
    ctx.storage.mount('domain', facility)
    ctx.provide('storageDomain', facility)

    const askerAgent = {
      id: 's-a', session: { id: 's-a' }, followup: vi.fn(), ctx: { get: () => undefined },
    }
    const answerAgent = {
      id: 's-b', session: { id: 's-b' }, followup: vi.fn(), ctx: { get: () => undefined },
    }
    const agentFor = (sessionId: string) => (sessionId === 's-a' ? askerAgent : answerAgent)
    ctx.provide('agents', { get: (id: string) => agentFor(id) } as never)
    ctx.provide('sessionController', {
      create: async () => ({ sessionId: 's-created' }),
      resolveAgent: async (id: string) => ({ agent: agentFor(id) }),
    } as never)
    ctx.provide('workspaceRegistry', { get: (id: WorkspaceId) => ({ id }) } as never)
    await ctx.plugin(BotRegistry)
    const registry = ctx.bots
    const asker = await registry.create({
      name: '测试助手', description: '负责测试。', preset: 'standard', workspaceId: WorkspaceId('ws-1'),
    })
    const answerer = await registry.create({
      name: '代码审查员', description: '审查每个 diff。', preset: 'standard', workspaceId: WorkspaceId('ws-1'),
    })
    await asker.adoptConversation('s-a' as never)
    await answerer.adoptConversation('s-b' as never)
    return { ctx, registry, asker, answerer, askerAgent, answerAgent }
  }

  const consultFrameOf = (agent: { followup: ReturnType<typeof vi.fn> }) =>
    agent.followup.mock.calls[0]?.[0] as {
      content: Array<{ text?: string }>
      source: { kind: string; questionId?: string; round?: number }
    }

  it('delivers the question, captures the closing turn, and wakes the asker with the answer', async () => {
    const { ctx, asker, answerer, askerAgent, answerAgent } = await harness()
    await asker.ensureConversation()
    await answerer.ensureConversation()

    await ctx.bots.deliverConsult(asker, answerer, '这个改动风险如何？', 1)
    const question = consultFrameOf(answerAgent)
    expect(question.source.kind).toBe('bot-consult')
    expect(question.source.round).toBe(1)
    expect(question.content[0]?.text).toContain('这个改动风险如何？')

    // The consulted Bot's closing turn carries the answer back.
    const session = { id: 's-b' } as never
    fire(ctx, session, { type: 'turn/start', data: { turn: 1 } })
    fire(ctx, session, {
      type: 'assistant/message',
      data: { turn: 1, message: { content: [{ type: 'text', text: '风险在并发写。' }] } },
    })
    fire(ctx, session, { type: 'turn/end', data: { turn: 1 } })

    await vi.waitFor(() => { expect(askerAgent.followup).toHaveBeenCalledTimes(1) })
    const answer = consultFrameOf(askerAgent)
    expect(answer.source.kind).toBe('bot-consult-answer')
    expect(answer.source.round).toBe(1)
    expect(answer.content[0]?.text).toContain('风险在并发写。')
  })

  it('ignores a turn that was already running before the question arrived', async () => {
    const { ctx, asker, answerer, askerAgent, answerAgent } = await harness()
    await asker.ensureConversation()
    await answerer.ensureConversation()

    const session = { id: 's-b' } as never
    fire(ctx, session, { type: 'turn/start', data: { turn: 4 } })
    await ctx.bots.deliverConsult(asker, answerer, 'q', 1)
    // The unrelated turn closes with its own text; nothing may be routed back.
    fire(ctx, session, {
      type: 'assistant/message',
      data: { turn: 4, message: { content: [{ type: 'text', text: '这段工作不是回答。' }] } },
    })
    fire(ctx, session, { type: 'turn/end', data: { turn: 4 } })
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(askerAgent.followup).not.toHaveBeenCalled()
    expect(answerAgent.followup).toHaveBeenCalledTimes(1)

    // The next turn is the one that answers the question.
    fire(ctx, session, { type: 'turn/start', data: { turn: 5 } })
    fire(ctx, session, {
      type: 'assistant/message',
      data: { turn: 5, message: { content: [{ type: 'text', text: '真正的回答' }] } },
    })
    fire(ctx, session, { type: 'turn/end', data: { turn: 5 } })
    await vi.waitFor(() => { expect(askerAgent.followup).toHaveBeenCalledTimes(1) })
    expect(consultFrameOf(askerAgent).content[0]?.text).toContain('真正的回答')
  })
})
