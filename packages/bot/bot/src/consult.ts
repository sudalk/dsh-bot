/**
 * Bot consultation: one Bot asking a teammate a question and getting the
 * answer back. This is the second collaboration gear beside `handoff_to_bot`:
 * a handoff transfers the work for good, while a consultation borrows an
 * answer and continues the asking Bot's own task. Delivery is asynchronous —
 * the question lands in the teammate's conversation, and its reply is routed
 * back as a new message that wakes the asker — so neither Bot ever holds a
 * call open waiting on the other.
 * @module @deepseek-ai/dsh-bot/src/consult
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { InferValue } from '@deepseek-ai/dsh-tools'
import { bound, jsonOutput } from './tool-shared.ts'
import type { Bot, BotId } from './types.ts'

/** Longest question text one consultation frame carries; longer questions are cut with an ellipsis. */
export const BOT_CONSULT_QUESTION_MAX_CHARS = 4_000

/** Longest captured answer folded back into the asker's conversation. */
export const BOT_CONSULT_ANSWER_MAX_CHARS = 8_000

/** Consultation rounds one chain may run before a Bot must continue on its own. */
export const BOT_CONSULT_MAX_ROUNDS = 3

/**
 * Source recorded on the question message delivered into the consulted Bot's
 * conversation. `round` bounds a back-and-forth chain, and `questionId` links
 * the eventual answer back to the question that produced it.
 */
export interface BotConsultSource {
  readonly kind: 'bot-consult'
  /** Bot asking the question. */
  readonly senderBotId: BotId
  /** Display name of the asking Bot, for rendering. */
  readonly senderName: string
  /** Identity of this question, reused by the answer frame. */
  readonly questionId: string
  /** 1 for a question out of a user-driven turn; one more per consult round. */
  readonly round: number
}

/**
 * Source recorded on the answer message delivered back into the asker's
 * conversation. It carries the question it answers so the asker can read the
 * exchange without the teammate's transcript.
 */
export interface BotConsultAnswerSource {
  readonly kind: 'bot-consult-answer'
  /** Bot that answered. */
  readonly senderBotId: BotId
  /** Display name of the answering Bot, for rendering. */
  readonly senderName: string
  /** Identity of the question this answers. */
  readonly questionId: string
  /** Round of the question this answers. */
  readonly round: number
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'bot-consult': BotConsultSource
    'bot-consult-answer': BotConsultAnswerSource
  }
}

/**
 * Host capabilities the consultation tool calls. The Bot registry implements
 * this: it owns the roster, the wake-up path, and the reply-capture engine
 * that routes the answer back to the asker.
 */
export interface BotConsultHost {
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
   * Display names of every Bot on the roster, for the resolvable-list diagnostic.
   * @returns roster names in roster order.
   */
  rosterNames(): readonly string[]

  /**
   * Deliver one consultation question into the target Bot's conversation,
   * arming the reply capture that routes its answer back to `from`.
   * @param from - Bot asking the question.
   * @param target - Bot being consulted.
   * @param question - Question text as the asking Bot wrote it.
   * @param round - Round of this question within its chain.
   * @returns resolution after the question was admitted to the target's queue.
   */
  deliverConsult(from: Bot, target: Bot, question: string, round: number): Promise<void>
}

/** Model-facing result of one accepted consultation. */
type ConsultValue = InferValue<typeof CONSULT_VALUE_SCHEMA>

const CONSULT_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    teammate: { type: 'string', required: true },
    asked: { type: 'boolean', required: true },
  },
} as const

/**
 * Render the frame one consulted Bot reads. The frame states who is asking and
 * that the reply goes back to them, so the answer reads as a direct reply
 * rather than as a task to transfer onward.
 * @param input - Asking Bot's name and the question text.
 * @returns the bounded delivery text.
 */
export function renderConsultFrame(input: {
  readonly fromName: string
  readonly question: string
}): string {
  return [
    `[队友咨询] 队友「${input.fromName}」向你请教一个问题：`,
    bound(input.question, BOT_CONSULT_QUESTION_MAX_CHARS),
    '他是来借一个答案，不是把工作交给你：请直接回答，你的回复会原样回传给他。'
    + '给出可直接使用的结论与依据；不要以反问代替回答，也不要再把这个咨询转给第三人。',
  ].join('\n\n')
}

/**
 * Render the frame one asking Bot reads when its teammate answered. The frame
 * quotes the question and the answer verbatim so the asker's own transcript
 * carries the exchange.
 * @param input - Answering Bot's name, the question, and the captured answer.
 * @returns the bounded delivery text.
 */
export function renderConsultAnswerFrame(input: {
  readonly fromName: string
  readonly question: string
  readonly answer: string
}): string {
  return [
    `[咨询回复] 队友「${input.fromName}」回答了你之前的问题。`,
    `你的问题：\n${bound(input.question, BOT_CONSULT_QUESTION_MAX_CHARS)}`,
    `他的回答：\n${bound(input.answer, BOT_CONSULT_ANSWER_MAX_CHARS)}`,
    '这次咨询到此结束，请继续你自己的任务；仍需要他补充时，可以再咨询一次。',
  ].join('\n\n')
}

/**
 * Install the `ask_teammate` tool on one live Bot Agent's own scope. The tool
 * asks a teammate a question and hands control straight back: the answer
 * arrives later as a new message in this conversation.
 * @param agent - Live Agent composed for the Bot's conversation Session.
 * @param host - Registry capability resolving targets, delivering, and capturing replies.
 * @returns the disposer for the registration, or `undefined` without a tools service.
 */
export function installBotConsultTool(agent: Agent, host: BotConsultHost): (() => void) | undefined {
  const tools = agent.ctx.get('tools')
  if (tools === undefined) return undefined
  return tools.register(defineTool({
    name: 'ask_teammate',
    description: 'Ask another Bot on the roster one question and keep working. The question lands in that Bot\'s own chat with the user; its answer comes back to you as a new message in this conversation. Use it to borrow a teammate\'s judgment; use handoff_to_bot instead when the whole task belongs to them.',
    parameters: {
      bot: {
        type: 'string',
        required: true,
        description: 'Exact display name of the teammate to ask, as shown on the roster.',
      },
      question: {
        type: 'string',
        required: true,
        description: 'The complete question, including the context needed to answer it without further back-and-forth.',
      },
    },
    output: jsonOutput(CONSULT_VALUE_SCHEMA),
    async execute(args, exec) {
      const caller = exec.agent
      if (caller === undefined) throw new Error('ask_teammate requires a calling Agent')
      const from = host.byConversation(caller.id)
      if (from === undefined) {
        throw new Error('ask_teammate is available only inside a Bot conversation')
      }
      const target = host.byName(args.bot)
      if (target === undefined) {
        const names = host.rosterNames()
        const available = names.length === 0 ? 'the roster is empty' : `available: ${names.join(', ')}`
        throw new Error(`no Bot named "${args.bot}" is on the roster; ${available}; use the exact display name`)
      }
      if (target.id === from.id) throw new Error('a Bot cannot consult itself')
      if (args.question.trim() === '') throw new Error('the question must not be blank')
      const previous = latestConsult(caller.session)
      if (previous !== undefined && previous.kind === 'bot-consult' && previous.senderBotId === target.id) {
        throw new Error(`"${target.name}" is waiting for your answer right now; answer it directly instead of asking back`)
      }
      const round = (previous?.round ?? 0) + 1
      if (round > BOT_CONSULT_MAX_ROUNDS) {
        throw new Error(`this exchange already ran ${BOT_CONSULT_MAX_ROUNDS} rounds; continue with what you have`)
      }
      await host.deliverConsult(from, target, args.question, round)
      const value: ConsultValue = { teammate: target.name, asked: true }
      return value
    },
  }))
}

/** The most recent consult-family message that woke this conversation, if any. */
function latestConsult(session: Session): {
  readonly kind: 'bot-consult' | 'bot-consult-answer'
  readonly senderBotId: BotId
  readonly round: number
} | undefined {
  // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
  const events = session.snapshotEvents(session.inheritedEventCount)
  let latest: { kind: 'bot-consult' | 'bot-consult-answer'; senderBotId: BotId; round: number } | undefined
  for (const event of events) {
    if (event.type !== 'user/message') continue
    const source = event.data.source
    if (source.kind !== 'bot-consult' && source.kind !== 'bot-consult-answer') continue
    latest = { kind: source.kind, senderBotId: source.senderBotId, round: source.round }
  }
  return latest
}
