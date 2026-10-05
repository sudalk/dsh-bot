/**
 * Bot roster awareness: what one Bot knows about its teammates. The persona
 * gains a bounded roster block so a Bot recognizes who owns what, and the
 * `list_bots` tool answers the same question on demand with fuller
 * descriptions. Both read the durable roster the handoff tool resolves names
 * against, so perceiving a teammate and reaching one stay the same list.
 * @module @deepseek-ai/dsh-bot/src/roster
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { InferValue } from '@deepseek-ai/dsh-tools'
import { bound, jsonOutput } from './tool-shared.ts'
import type { Bot } from './types.ts'

/** Teammate entries the persona block carries before it points at `list_bots`. */
export const BOT_ROSTER_PERSONA_MAX_ENTRIES = 12

/** Longest teammate description the persona block carries per teammate. */
export const BOT_ROSTER_PERSONA_DESCRIPTION_MAX_CHARS = 200

/** Longest teammate description the `list_bots` tool answers with per teammate. */
export const BOT_ROSTER_DESCRIPTION_MAX_CHARS = 500

/** The two roster facts a teammate is surfaced by: who it is and what it owns. */
export interface BotTeammate {
  /** Display name as shown on the roster. */
  readonly name: string
  /** Durable job description in operational terms. */
  readonly description: string
}

/**
 * Render the persona's roster block for one Bot's teammates. Absent when the
 * Bot has no teammates, so a one-Bot roster pays no context cost. The block
 * is capped: further teammates are named by count and reachable through
 * `list_bots`.
 * @param teammates - Every other Bot on the roster, in roster order.
 * @returns the roster paragraph, or `undefined` without teammates.
 */
export function renderRosterPreamble(teammates: readonly BotTeammate[]): string | undefined {
  if (teammates.length === 0) return undefined
  const shown = teammates.slice(0, BOT_ROSTER_PERSONA_MAX_ENTRIES)
  const lines = shown.map(teammate =>
    `- 「${teammate.name}」：${bound(teammate.description, BOT_ROSTER_PERSONA_DESCRIPTION_MAX_CHARS)}`)
  const hidden = teammates.length - shown.length
  return [
    '你所在的产品维护着一份 Bot 队友名册。以下队友与你共事；某件事属于他们的职责而不是你的，用 `handoff_to_bot` 交给本人：',
    ...lines,
    ...hidden > 0 ? [`此外还有 ${hidden} 位队友；用 list_bots 查看完整名册。`] : [],
  ].join('\n')
}

/** Model-facing result of one `list_bots` call. */
export type BotRosterValue = InferValue<typeof ROSTER_VALUE_SCHEMA>

const ROSTER_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    bots: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', required: true },
          description: { type: 'string', required: true },
        },
      },
    },
  },
} as const

/**
 * Host capabilities the roster tool reads. The Bot registry implements this:
 * it owns the roster and resolves the calling Agent's own Bot.
 */
export interface BotRosterHost {
  /**
   * Resolve the Bot that owns one conversation Session.
   * @param sessionId - Session identity to resolve.
   * @returns the owning Bot, or `undefined` when no Bot holds that conversation.
   */
  byConversation(sessionId: SessionId): Bot | undefined

  /**
   * List every Bot on the roster, in roster order.
   * @returns the roster.
   */
  list(): readonly Bot[]
}

/**
 * Install the `list_bots` tool on one live Bot Agent's own scope. The tool is
 * how a Bot inspects the roster while working — fuller descriptions than the
 * persona block carries, so it can pick the right teammate before a handoff
 * or a consultation.
 * @param agent - Live Agent composed for the Bot's conversation Session.
 * @param host - Registry capability listing the roster and reading the caller.
 * @returns the disposer for the registration, or `undefined` without a tools service.
 */
export function installBotRosterTool(agent: Agent, host: BotRosterHost): (() => void) | undefined {
  const tools = agent.ctx.get('tools')
  if (tools === undefined) return undefined
  return tools.register(defineTool({
    name: 'list_bots',
    description: 'List the other Bots on the roster with their standing jobs. Use it to check who owns a kind of work before handing a task over or asking a teammate; your own entry is not listed.',
    parameters: {},
    output: jsonOutput(ROSTER_VALUE_SCHEMA),
    execute(_args, exec) {
      const caller = exec.agent
      if (caller === undefined) throw new Error('list_bots requires a calling Agent')
      const self = host.byConversation(caller.id)
      if (self === undefined) {
        throw new Error('list_bots is available only inside a Bot conversation')
      }
      const value: BotRosterValue = {
        bots: host.list()
          .filter(bot => bot.id !== self.id)
          .map(bot => ({
            name: bot.name,
            description: bound(bot.description, BOT_ROSTER_DESCRIPTION_MAX_CHARS),
          })),
      }
      return Promise.resolve(value)
    },
  }))
}
