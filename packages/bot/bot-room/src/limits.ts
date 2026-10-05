/**
 * Every numeric bound one room enforces, in one place so the store, the
 * delivery engine, and their tests share the same limits.
 * @module @deepseek-ai/dsh-bot-room/src/limits
 */

/** Longest accepted room display name, so a sidebar row stays renderable. */
export const ROOM_NAME_MAX_CHARS = 120

/** Longest accepted room message body. */
export const ROOM_MESSAGE_MAX_CHARS = 8_000

/** Fewest Bots a room may address, matching a group chat rather than a DM. */
export const ROOM_MEMBERS_MIN = 2

/** Most Bots one room may address. */
export const ROOM_MEMBERS_MAX = 6

/** Deliveries one root message may spawn across every target and handoff. */
export const ROOM_DELIVERY_MAX = 8

/** Longest chain of Bot-to-Bot handoffs a root message may trigger. */
export const ROOM_HANDOFF_MAX_DEPTH = 4

/** Recent-log entries folded into one delivery frame. */
export const ROOM_FRAME_RECENT_COUNT = 10

/** Longest rendered delivery frame; older context is truncated when it exceeds this. */
export const ROOM_FRAME_MAX_CHARS = 4_000

/** Longest single recent-log line folded into a delivery frame. */
export const ROOM_FRAME_LINE_MAX_CHARS = 280
