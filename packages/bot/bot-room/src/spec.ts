/**
 * The Bot room domain declaration: durable group-chat records and their
 * message log, in their own storage domain so a room's lifecycle and record
 * shape version independently of the Bot roster. The zod schemas validate the
 * shipped format at the durability boundary.
 * @module @deepseek-ai/dsh-bot-room/src/spec
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { BotId } from '@deepseek-ai/dsh-bot/types'
import type { RoomId, RoomMessageId } from './types.ts'

const botId = z.string().transform(value => value as BotId)

const roomId = z.string().transform(value => value as RoomId)

/**
 * Durable shape of one Room record. `name` and `memberIds` are display and
 * routing data; the transcript lives in the `messages` table. `sessionId` is
 * a retired field kept only so records written before the room owned a log
 * still load; nothing reads or writes it.
 */
export const roomRecord = z.object({
  name: z.string(),
  memberIds: z.array(botId),
  sessionId: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

/** One stored Room record, inferred from {@link roomRecord}. */
export type RoomRecord = z.infer<typeof roomRecord>

/**
 * Durable shape of one room-log message. The author is recorded by value so a
 * later Bot rename never rewrites history; `mentions` names the Bots the
 * message addressed, which is what delivery and handoff re-read.
 */
export const roomMessageRecord = z.object({
  roomId,
  senderKind: z.enum(['user', 'bot', 'system']),
  senderId: z.string().optional(),
  senderName: z.string(),
  text: z.string(),
  mentions: z.array(botId),
  createdAt: z.string(),
})

/** One stored room message, inferred from {@link roomMessageRecord}. */
export type RoomMessageRecord = z.infer<typeof roomMessageRecord>

/**
 * The room domain spec: a `rooms` table keyed by {@link RoomId} and a
 * `messages` table keyed by {@link RoomMessageId}. Creation order is each
 * record's own `createdAt`, so the domain declares no global singleton.
 */
export const roomDomainSpec = defineDomain({
  name: 'bot_room',
  version: 1,
  tables: {
    rooms: domainTable<RoomId, RoomRecord>(roomRecord),
    messages: domainTable<RoomMessageId, RoomMessageRecord>(roomMessageRecord),
  },
})
