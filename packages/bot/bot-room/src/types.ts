/**
 * Public type vocabulary of a Room: the `RoomId` and `RoomMessageId` brands,
 * the profiles a caller writes, and the `Room` and `RoomMessage` consumer
 * interfaces. Types only — the id factories live in `index.ts` (this file
 * carries no runtime code).
 * @module @deepseek-ai/dsh-bot-room/src/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { BotId } from '@deepseek-ai/dsh-bot/types'
import type {} from '@deepseek-ai/dsh-typert-protocol'

/** Identifies one Room record. A generated uuid, never the display name. */
export type RoomId = Branded<'RoomId'>

/** Identifies one Room message record. A generated uuid, never a sequence number. */
export type RoomMessageId = Branded<'RoomMessageId'>

/** Who authored one room message. */
export type RoomSenderKind = 'user' | 'bot' | 'system'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** No Room record carries that room identity. */
    'bot/room-not-found': { readonly roomId: RoomId }
  }
}

/**
 * Durable identity of one Room: a named group chat whose transcript is the
 * room's own message log. `memberIds` is the Bot roster the room addresses,
 * in join order; membership is display and routing data.
 */
export interface RoomProfile {
  /** Display name of the group chat. */
  readonly name: string
  /** Bots addressed in this room, in the order they joined. */
  readonly memberIds: readonly BotId[]
}

/** Fields a caller may change after creation; identity and creation instant never change. */
export type RoomProfileUpdate = Partial<RoomProfile>

/**
 * One Room: a durable group chat with its own message log. Consumers only see
 * this interface; the stored record stays package-private.
 */
export interface Room extends RoomProfile {
  /** Stable record id (generated uuid). */
  readonly id: RoomId
  /** ISO-8601 creation instant, stamped at create and never rewritten. */
  readonly createdAt: string
  /** ISO-8601 instant of the last durable mutation (create counts as one). */
  readonly updatedAt: string
}

/** One message a caller appends to a room log. */
export interface RoomMessageProfile {
  /** Room whose log receives the message. */
  readonly roomId: RoomId
  /** Author class: the human, one Bot, or the room itself. */
  readonly senderKind: RoomSenderKind
  /** Authoring Bot, required exactly when `senderKind` is `bot`. */
  readonly senderId?: BotId
  /** Display name recorded with the message; the author's name at send time. */
  readonly senderName: string
  /** Message body, verbatim. */
  readonly text: string
  /** Bots this message addressed, in first-mention order. */
  readonly mentions: readonly BotId[]
}

/**
 * One message in a room log: the shared transcript that makes several Bots
 * one visible conversation.
 */
export interface RoomMessage extends RoomMessageProfile {
  /** Stable record id (generated uuid). */
  readonly id: RoomMessageId
  /** ISO-8601 instant the message was appended. */
  readonly createdAt: string
}

/** Validation result for a proposed {@link RoomProfile}, produced before any write. */
export type RoomProfileValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string }

/** Validation result for a proposed {@link RoomMessageProfile}, produced before any write. */
export type RoomMessageValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string }

/** One room member resolved against the Bot roster, for frames and UI labels. */
export interface RoomMember {
  /** The member Bot. */
  readonly botId: BotId
  /** The Bot's display name, or its id when the record is gone. */
  readonly name: string
}
