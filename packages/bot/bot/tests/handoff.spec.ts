import { describe, expect, it, vi } from 'vitest'
import {
  BOT_HANDOFF_MAX_DEPTH,
  BOT_HANDOFF_TASK_MAX_CHARS,
  installBotHandoffTool,
  renderHandoffFrame,
} from '../src/handoff.ts'
import type { BotHandoffHost } from '../src/handoff.ts'
import { BotId } from '../src/index.ts'
import type { Bot } from '../src/types.ts'

const callerBot = bot('bot-a', '测试助手')
const targetBot = bot('bot-b', '代码审查员')

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

/** One handoff source as the target's conversation log carries it. */
function delivered(senderId: string, depth: number) {
  return {
    type: 'user/message',
    data: {
      source: { kind: 'bot-handoff', senderBotId: BotId(senderId), senderName: 'x', depth },
    },
  }
}

/** Install the tool over a captured registration and a scripted host. */
function harness(history: readonly unknown[] = []) {
  let captured: {
    name: string
    execute: (args: { bot: string; task: string }, exec: { agent: unknown }) => Promise<unknown>
  } | undefined
  const deliverHandoff = vi.fn(async () => {})
  const host: BotHandoffHost = {
    byConversation: sessionId => (String(sessionId) === 'session-self' ? callerBot : undefined),
    byName: name => (name === targetBot.name ? targetBot : name === callerBot.name ? callerBot : undefined),
    rosterNames: () => [callerBot.name, targetBot.name],
    deliverHandoff,
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
  const dispose = installBotHandoffTool(agent as never, host)
  if (captured === undefined) throw new Error('handoff tool was not registered')
  return { tool: captured, deliverHandoff, dispose, agent }
}

describe('Bot handoff frame', () => {
  it('names the handing-off teammate and keeps the task verbatim', () => {
    const frame = renderHandoffFrame({ fromName: '测试助手', task: '写一句欢迎语' })
    expect(frame).toContain('[任务交接] 队友「测试助手」')
    expect(frame).toContain('写一句欢迎语')
    expect(frame).toContain('不是群聊点名')
  })

  it('cuts an oversized task with an ellipsis instead of flooding the request', () => {
    const frame = renderHandoffFrame({ fromName: 'A', task: 'x'.repeat(BOT_HANDOFF_TASK_MAX_CHARS + 500) })
    expect(frame).toContain('…')
    expect(frame.length).toBeLessThan(BOT_HANDOFF_TASK_MAX_CHARS + 400)
  })
})

describe('handoff_to_bot tool', () => {
  it('delivers to the named teammate and reports the target', async () => {
    const { tool, deliverHandoff, agent } = harness()
    const result = await tool.execute({ bot: '代码审查员', task: '看看 diff' }, { agent })
    expect(result).toEqual({ target: '代码审查员', delivered: true })
    expect(deliverHandoff).toHaveBeenCalledWith(callerBot, targetBot, '看看 diff', 1)
  })

  it('rejects unknown names, self-targets, and missing tools registration', async () => {
    const { tool, agent } = harness()
    await expect(tool.execute({ bot: '不存在的 Bot', task: 't' }, { agent }))
      .rejects.toThrow('no Bot named "不存在的 Bot"')
    await expect(tool.execute({ bot: '不存在的 Bot', task: 't' }, { agent }))
      .rejects.toThrow('available: 测试助手, 代码审查员')
    await expect(tool.execute({ bot: '测试助手', task: 't' }, { agent }))
      .rejects.toThrow('cannot hand a task to itself')
  })

  it('grows the chain depth from the handoff that woke this conversation', async () => {
    const { tool, deliverHandoff, agent } = harness([delivered('bot-x', 1)])
    await tool.execute({ bot: '代码审查员', task: 't' }, { agent })
    expect(deliverHandoff).toHaveBeenCalledWith(callerBot, targetBot, 't', 2)
  })

  it('refuses to bounce the task back to the teammate that just handed it over', async () => {
    const { tool, deliverHandoff, agent } = harness([delivered('bot-b', 1)])
    await expect(tool.execute({ bot: '代码审查员', task: 't' }, { agent }))
      .rejects.toThrow('just handed this task over')
    expect(deliverHandoff).not.toHaveBeenCalled()
  })

  it('stops a chain that already crossed the depth cap', async () => {
    const { tool, deliverHandoff, agent } = harness([delivered('bot-x', BOT_HANDOFF_MAX_DEPTH)])
    await expect(tool.execute({ bot: '代码审查员', task: 't' }, { agent }))
      .rejects.toThrow(`already crossed ${BOT_HANDOFF_MAX_DEPTH} Bots`)
    expect(deliverHandoff).not.toHaveBeenCalled()
  })

  it('requires a calling Agent and a tools service', async () => {
    const { tool } = harness()
    await expect(tool.execute({ bot: '代码审查员', task: 't' }, { agent: undefined }))
      .rejects.toThrow('requires a calling Agent')
    const bare = installBotHandoffTool({
      id: 's', session: {}, ctx: { get: () => undefined },
    } as never, {
      byConversation: () => undefined,
      byName: () => undefined,
      rosterNames: () => [],
      deliverHandoff: async () => {},
    })
    expect(bare).toBeUndefined()
  })
})
