/**
 * Bot-to-Bot task handoff: the `handoff_to_bot` tool one Bot calls to move a
 * task into another Bot's own conversation, the delivery frame that target
 * reads, and the source recorded on the wake-up message. A handoff never
 * creates a room and never invents a Session: the target works in its single
 * durable conversation, which is exactly where the user can watch it.
 * @module @deepseek-ai/dsh-bot/src/handoff
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { InferValue } from '@deepseek-ai/dsh-tools'
import { bound, jsonOutput } from './tool-shared.ts'
import type { Bot, BotId } from './types.ts'

/** Longest task text one handoff frame carries; longer tasks are cut with an ellipsis. */
export const BOT_HANDOFF_TASK_MAX_CHARS = 8_000

/** Handoff chain length one task may travel before a Bot must do the work itself. */
export const BOT_HANDOFF_MAX_DEPTH = 3

/**
 * Source recorded on the wake-up message a handoff delivers. The target reads
 * its own conversation log through this marker to tell a teammate's task from
 * a user turn, which is also what stops a task from ping-ponging between two
 * Bots.
 */
export interface BotHandoffSource {
  readonly kind: 'bot-handoff'
  /** Bot that performed the handoff. */
  readonly senderBotId: BotId
  /** Display name of the handing-off Bot, for rendering. */
  readonly senderName: string
  /** 1 for a handoff out of a user-driven turn; one more per further hop. */
  readonly depth: number
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'bot-handoff': BotHandoffSource
  }
}

/**
 * Host capabilities the handoff tool calls. The Bot registry implements this:
 * it owns the roster the tool resolves names against and the conversation
 * wake-up path it delivers through.
 */
export interface BotHandoffHost {
  /**
   * Resolve the Bot that owns one conversation Session.
   * @param sessionId - Session identity to resolve.
   * @returns the owning Bot, or `undefined` when no Bot holds that conversation.
   */
  byConversation(sessionId: SessionId): Bot | undefined

  /**
   * Resolve one Bot by exact display name.
   * @param name - Display name as shown on the roster.
   * @returns the first Bot carrying that name, or `undefined`.
   */
  byName(name: string): Bot | undefined

  /**
   * Display names of every Bot on the roster, for the resolvable-list
   * diagnostic an unknown target answers with.
   * @returns roster names in roster order.
   */
  rosterNames(): readonly string[]

  /**
   * Deliver one handoff frame into the target Bot's conversation and wake it.
   * @param from - Bot handing the task over.
   * @param target - Bot receiving the task.
   * @param task - Task text as the handing-off Bot wrote it.
   * @param depth - Depth of this hop on the handoff chain.
   * @returns resolution after the frame was admitted to the target's queue.
   */
  deliverHandoff(from: Bot, target: Bot, task: string, depth: number): Promise<void>
}

/** Model-facing result of one accepted handoff. */
type HandoffValue = InferValue<typeof HANDOFF_VALUE_SCHEMA>

const HANDOFF_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    target: { type: 'string', required: true },
    delivered: { type: 'boolean', required: true },
  },
} as const

/** Declare the tool output schema with compact model-facing JSON. */

/**
 * Render the frame one target Bot reads when a teammate hands it a task. The
 * frame names the handing-off teammate and states the delivery path, so the
 * target answers the task rather than the frame itself.
 * @param input - Handing-off Bot's name and the task text.
 * @returns the bounded delivery text.
 */
export function renderHandoffFrame(input: {
  readonly fromName: string
  readonly task: string
}): string {
  return [
    `[任务交接] 队友「${input.fromName}」把一件事交给你处理：`,
    bound(input.task, BOT_HANDOFF_TASK_MAX_CHARS),
    `这件事由用户通过「${input.fromName}」的会话转来，不是群聊点名；请按你自己的职责直接处理它，`
    + '并把结论整理成给用户看的回复——用户会打开你的会话查看结果。',
  ].join('\n\n')
}

/**
 * Install the `handoff_to_bot` tool on one live Bot Agent's own scope. The
 * tool is how a Bot routes work it does not own to the teammate that does,
 * without creating a group chat.
 * @param agent - Live Agent composed for the Bot's conversation Session.
 * @param host - Registry capability resolving targets and delivering frames.
 * @returns the disposer for the registration, or `undefined` without a tools service.
 */
export function installBotHandoffTool(agent: Agent, host: BotHandoffHost): (() => void) | undefined {
  const tools = agent.ctx.get('tools')
  if (tools === undefined) return undefined
  return tools.register(defineTool({
    name: 'handoff_to_bot',
    description: 'Hand one task to another Bot on the roster. The task lands in that Bot\'s own chat with the user, where it works under its own standing rules and the user can follow the progress. Use it when another teammate owns the needed expertise; do not use it to ask something you can already do yourself.',
    parameters: {
      bot: {
        type: 'string',
        required: true,
        description: 'Exact display name of the target Bot as shown on the roster.',
      },
      task: {
        type: 'string',
        required: true,
        description: 'Complete, self-contained task for the target Bot: what to do and what the result should look like.',
      },
    },
    output: jsonOutput(HANDOFF_VALUE_SCHEMA),
    async execute(args, exec) {
      const caller = exec.agent
      if (caller === undefined) throw new Error('handoff_to_bot requires a calling Agent')
      const from = host.byConversation(caller.id)
      if (from === undefined) {
        throw new Error('handoff_to_bot is available only inside a Bot conversation')
      }
      const target = host.byName(args.bot)
      if (target === undefined) {
        const names = host.rosterNames()
        const available = names.length === 0 ? 'the roster is empty' : `available: ${names.join(', ')}`
        throw new Error(`no Bot named "${args.bot}" is on the roster; ${available}; use the exact display name`)
      }
      if (target.id === from.id) throw new Error('a Bot cannot hand a task to itself')
      const previous = latestHandoff(caller.session)
      if (previous !== undefined && previous.senderBotId === target.id) {
        throw new Error(`"${target.name}" just handed this task over; continue it in this conversation instead of handing it back`)
      }
      const depth = (previous?.depth ?? 0) + 1
      if (depth > BOT_HANDOFF_MAX_DEPTH) {
        throw new Error(`the task already crossed ${BOT_HANDOFF_MAX_DEPTH} Bots; do the remaining work in this conversation`)
      }
      await host.deliverHandoff(from, target, args.task, depth)
      const value: HandoffValue = { target: target.name, delivered: true }
      return value
    },
  }))
}

/** The most recent handoff that woke this conversation, if any. */
function latestHandoff(session: Session): { readonly senderBotId: BotId; readonly depth: number } | undefined {
  // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
  const events = session.snapshotEvents(session.inheritedEventCount)
  let latest: { senderBotId: BotId; depth: number } | undefined
  for (const event of events) {
    if (event.type === 'user/message' && event.data.source.kind === 'bot-handoff') {
      latest = { senderBotId: event.data.source.senderBotId, depth: event.data.source.depth }
    }
  }
  return latest
}
