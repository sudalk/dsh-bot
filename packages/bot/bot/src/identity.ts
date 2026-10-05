/**
 * Bot identity: the system-prompt persona one Bot's conversations compose
 * from, installed on each live Agent's own scope so the deployment prompt is
 * untouched for every other Session.
 * @module @deepseek-ai/dsh-bot/src/identity
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { renderRosterPreamble } from './roster.ts'
import type { BotTeammate } from './roster.ts'
import type { Bot } from './types.ts'

/**
 * The system-prompt identity of one Bot: its durable name, standing role, and
 * the roster of teammates it works beside. `description` carries the durable
 * rules, so the persona text is composed from the record instead of being
 * stored twice; the teammate block is added from the same roster the handoff
 * tool resolves against, so naming a teammate and reaching one cannot drift.
 * @param bot - Bot whose persona is rendered.
 * @param teammates - Every other Bot on the roster, in roster order.
 * @returns the persona section text.
 */
export function botPersona(
  bot: Pick<Bot, 'name' | 'description'>,
  teammates: readonly BotTeammate[] = [],
): string {
  const roster = renderRosterPreamble(teammates)
  return `You are "${bot.name}" — a durable teammate the user keeps on this product's Bot roster,`
    + ' and this name is how the user knows you. Speak and act as this teammate for the whole'
    + ' conversation; this identity is current and overrides anything earlier turns in this'
    + ' conversation said about you — never introduce yourself as a generic coding agent or a team lead.'
    + `\nYour standing role and rules:\n${bot.description}`
    + (roster === undefined ? '' : `\n\n${roster}`)
}

/**
 * Install one Bot's persona on one live Agent's own scope. Registration goes
 * through the Agent's scope, which is the documented per-Agent override seat:
 * the deployment persona and its suffix stay everywhere else, and the Agent's
 * runtime context, tools, and every later turn keep working unchanged.
 * @param agent - Live Agent composed for the Bot's conversation Session.
 * @param bot - Bot whose identity is installed.
 * @param teammates - Every other Bot on the roster, in roster order.
 * @returns whether the persona was installed (absent without a prompt service).
 */
export function installBotIdentity(
  agent: Agent,
  bot: Pick<Bot, 'name' | 'description'>,
  teammates: readonly BotTeammate[] = [],
): boolean {
  const prompt = agent.ctx.get('systemPrompt')
  if (prompt === undefined) return false
  prompt.section({
    // `dsh-system-prompt` owns this slot as `PERSONA_PREFIX_SECTION`, but only
    // an identically named scoped section shadows the deployment persona, so
    // the name is spelled out here the way `dsh-subagent` spells it for child
    // personas. Renaming the constant there stops Bot chat from shadowing.
    name: 'deployment:persona-prefix',
    order: prompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX'),
    text: botPersona(bot, teammates),
  })
  return true
}
