/**
 * Delivery framing for room messages: the one text a target Bot reads when a
 * room message reaches its Session, bounded so a long log never floods a
 * request.
 * @module @deepseek-ai/dsh-bot-room/src/frame
 */

import { ROOM_FRAME_LINE_MAX_CHARS, ROOM_FRAME_MAX_CHARS, ROOM_FRAME_RECENT_COUNT } from './limits.ts'

/** Token a Bot replies with when it has nothing to add; that reply stays out of the room. */
export const ROOM_SKIP_TOKEN = '[skip]'

/** One member line of a delivery frame. */
export interface RoomFrameMember {
  /** The member's display name. */
  readonly name: string
}

/** One recent-log line of a delivery frame. */
export interface RoomFrameMessage {
  /** Display name recorded with the message. */
  readonly senderName: string
  /** Message body. */
  readonly text: string
}

/** Everything one delivery frame renders from. */
export interface RoomFrameInput {
  /** Room display name. */
  readonly roomName: string
  /** Current members, in join order. */
  readonly members: readonly RoomFrameMember[]
  /** Recent log entries, oldest first, excluding the message being delivered. */
  readonly recent: readonly RoomFrameMessage[]
  /** Display name of the author whose message is being delivered. */
  readonly senderName: string
  /** The delivered message body. */
  readonly text: string
}

/**
 * Decide whether a Bot reply declines to participate. A reply whose first
 * non-whitespace token is the skip token never reaches the room log.
 * @param text - The captured reply text.
 * @returns whether the reply is a skip.
 */
export function isRoomSkip(text: string): boolean {
  return text.trimStart().toLowerCase().startsWith(ROOM_SKIP_TOKEN)
}

/**
 * Render the frame one target Bot reads. The frame names the room and its
 * members, folds in the newest recent-log entries that fit, states the reply
 * rules, and always carries the delivered message verbatim up to the bound.
 * @param input - Room identity, members, recent log, author, and message.
 * @returns the bounded delivery text.
 */
export function renderRoomDeliveryFrame(input: RoomFrameInput): string {
  const separator = '\n\n'
  const header = `[群聊「${input.roomName}」]\n成员：${input.members.map(member => member.name).join('、')}`
  const rules = `回复规则：只有你能推进这件事时才回复；不需要你参与时只回复 ${ROOM_SKIP_TOKEN}。`
    + '\n只写你要说的内容本身，不要以「用户:」这类发言者前缀开头，也不要复述本条规则；'
    + '用 @成员名 可以把事情点给群里的另一个 Bot。'
  const lead = `—— 以下是「${input.senderName}」刚发进群里的话 ——\n`
  const recentTitle = '最近的群聊消息（旧 → 新）：'
  const overhead = header.length + lead.length + rules.length + separator.length * 3
  const text = bound(input.text, Math.max(0, ROOM_FRAME_MAX_CHARS - overhead))
  const newBlock = `${lead}${text}`
  let budget = ROOM_FRAME_MAX_CHARS - overhead - text.length - recentTitle.length - 1
  const lines: string[] = []
  for (const message of input.recent.slice(-ROOM_FRAME_RECENT_COUNT).reverse()) {
    const line = bound(`${message.senderName}: ${message.text}`, ROOM_FRAME_LINE_MAX_CHARS)
    if (line.length + 1 > budget) break
    lines.unshift(line)
    budget -= line.length + 1
  }
  const recentBlock = lines.length === 0 ? '' : `${recentTitle}\n${lines.join('\n')}`
  return [header, recentBlock, newBlock, rules].filter(block => block !== '').join(separator)
}

/** Cut one string to the bound, marking the cut with an ellipsis. */
function bound(text: string, max: number): string {
  if (text.length <= max) return text
  if (max <= 1) return text.slice(0, Math.max(0, max))
  return `${text.slice(0, max - 1)}…`
}
