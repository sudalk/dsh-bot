/**
 * Bot permission: pin one Bot's conversations to a permission preset, so a
 * teammate the user armed — full file access without approval prompts — stays
 * armed on every open instead of quietly falling back to the deployment
 * default. The pin is written to the Session of every Agent composed for the
 * Bot's continuing conversation, which is exactly what the sandbox and
 * approval gates read at call time.
 * @module @deepseek-ai/dsh-bot/src/permission
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { PermissionPresetService } from '@deepseek-ai/dsh-permission-presets'
import type { Bot } from './types.ts'

/**
 * Apply one Bot's pinned permission preset to one live Agent's Session.
 * A Bot without a pin follows the deployment default untouched. A pin this
 * deployment cannot honour — no permission service, or a preset name it does
 * not offer — also leaves the deployment default in place and reports through
 * `warn`: an unusable pin degrades a teammate's capability, and must not
 * break the composition that carries its identity.
 * @param agent - Live Agent composed for the Bot's conversation.
 * @param bot - Bot whose pinned preset is applied.
 * @param presets - Deployment permission service, absent without its plugin.
 * @param warn - Diagnostic sink for a pin that could not be applied.
 * @returns whether a preset was applied.
 */
export function installBotPermission(
  agent: Agent,
  bot: Pick<Bot, 'name' | 'permission'>,
  presets: PermissionPresetService | undefined,
  warn: (message: string) => void,
): boolean {
  const name = bot.permission
  if (name === undefined) return false
  if (presets === undefined) {
    warn(`Bot "${bot.name}" pins permission preset "${name}" but this deployment composes no permission presets`)
    return false
  }
  if (!presets.names.includes(name)) {
    warn(`Bot "${bot.name}" pins permission preset "${name}", which this deployment does not offer (available: ${presets.names.join(', ')})`)
    return false
  }
  try {
    presets.set(agent.session, name)
    return true
  } catch (error) {
    warn(`Bot "${bot.name}" could not apply permission preset "${name}": ${error instanceof Error ? error.message : String(error)}`)
    return false
  }
}

/**
 * Return one live Agent's Session to the deployment's default permission.
 * Clearing a pin has to take effect on the running conversation, not only on
 * the next cold resume: the roster would otherwise claim the Bot is back on
 * the default while its session still runs under the preset the user just
 * gave up.
 * @param agent - Live Agent composed for the Bot's conversation.
 * @param presets - Deployment permission service, absent without its plugin.
 * @param warn - Diagnostic sink for a default that could not be applied.
 * @returns whether the deployment default was applied.
 */
export function restoreDefaultPermission(
  agent: Agent,
  presets: PermissionPresetService | undefined,
  warn: (message: string) => void,
): boolean {
  if (presets === undefined) return false
  try {
    presets.set(agent.session, presets.defaultPreset)
    return true
  } catch (error) {
    warn(`could not restore the deployment default permission: ${error instanceof Error ? error.message : String(error)}`)
    return false
  }
}
