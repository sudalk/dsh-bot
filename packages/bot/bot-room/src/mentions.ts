/**
 * Room mention resolution: which member Bots one message addresses, parsed
 * before any model call so delivery targets are never guessed by a model.
 * @module @deepseek-ai/dsh-bot-room/src/mentions
 */

import type { BotId } from '@deepseek-ai/dsh-bot/types'
import type { RoomMember } from './types.ts'

/** Aliases addressing every member of the room. */
export const ROOM_EVERYONE_ALIASES = ['@everyone', '@所有人', '@全体成员'] as const

/** Resolved audience of one room message. */
export interface RoomMentionResult {
  /** Mentioned members in first-mention order, without duplicates. */
  readonly botIds: readonly BotId[]
  /** Whether an everyone alias addressed every member. */
  readonly everyone: boolean
}

/**
 * Resolve the Bots one message mentions. Names match as the longest member
 * name starting at an `@`, so two Bots whose names share a prefix stay
 * distinguishable; an everyone alias wins over any member name. Both the
 * human's message and a Bot's reply parse the same way, so a reply that
 * names another member is the handoff instruction.
 * @param text - Message body exactly as authored.
 * @param members - Current member Bots of the room.
 * @returns mentioned Bot ids and whether everyone was addressed.
 */
export function parseRoomMentions(text: string, members: readonly RoomMember[]): RoomMentionResult {
  const everyone = ROOM_EVERYONE_ALIASES.some(alias => text.includes(alias))
  const named = members
    .map(member => ({ id: member.botId, name: member.name }))
    .filter(member => member.name !== '')
    .sort((left, right) => right.name.length - left.name.length)
  const botIds: BotId[] = []
  const seen = new Set<string>()
  for (let at = text.indexOf('@'); at >= 0; at = text.indexOf('@', at + 1)) {
    const match = named.find(member => text.startsWith(member.name, at + 1))
    if (match === undefined) continue
    at += match.name.length
    const key = String(match.id)
    if (seen.has(key)) continue
    seen.add(key)
    botIds.push(match.id)
  }
  return { botIds, everyone }
}
