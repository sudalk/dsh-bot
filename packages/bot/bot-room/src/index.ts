/**
 * Bot rooms (`ctx.botRooms`): durable group chats with their own append-only
 * message log, over the Bot roster. A room owns no Session — its log is the
 * shared transcript — and posting a message delivers it into each addressed
 * member Bot's own conversation, folding their replies back into the log.
 * @module @deepseek-ai/dsh-bot-room
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { BotId } from '@deepseek-ai/dsh-bot/types'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-storage'
import type {} from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-bot'
import { BotRoomDelivery } from './delivery.ts'
import type { RoomActivity, RoomPostAuthor } from './delivery.ts'
import { roomDomainSpec } from './spec.ts'
import { BotRoomStore, BotRoomUnknownBotError } from './rooms.ts'
import type {
  Room, RoomId as RoomIdBrand, RoomMember, RoomMessage, RoomMessageId as RoomMessageIdBrand,
  RoomMessageProfile, RoomProfile,
} from './types.ts'

export type {
  Room, RoomMember, RoomMessage, RoomMessageProfile, RoomMessageValidation,
  RoomProfile, RoomProfileUpdate, RoomSenderKind,
} from './types.ts'
export type { BotId } from '@deepseek-ai/dsh-bot/types'
export { roomDomainSpec, roomRecord, roomMessageRecord } from './spec.ts'
export type { RoomRecord, RoomMessageRecord } from './spec.ts'
export {
  BotRoomInvalidError, BotRoomNotFoundError, BotRoomStore, BotRoomUnknownBotError,
  validateRoomMessage, validateRoomProfile,
} from './rooms.ts'
export {
  ROOM_DELIVERY_MAX, ROOM_FRAME_LINE_MAX_CHARS, ROOM_FRAME_MAX_CHARS, ROOM_FRAME_RECENT_COUNT,
  ROOM_HANDOFF_MAX_DEPTH, ROOM_MEMBERS_MAX, ROOM_MEMBERS_MIN, ROOM_MESSAGE_MAX_CHARS,
  ROOM_NAME_MAX_CHARS,
} from './limits.ts'
export { parseRoomMentions, ROOM_EVERYONE_ALIASES } from './mentions.ts'
export type { RoomMentionResult } from './mentions.ts'
export { isRoomSkip, renderRoomDeliveryFrame, ROOM_SKIP_TOKEN } from './frame.ts'
export type { RoomFrameInput, RoomFrameMember, RoomFrameMessage } from './frame.ts'
export { BotRoomDelivery } from './delivery.ts'
export type { RoomActivity, RoomMessageSource, RoomPostAuthor } from './delivery.ts'

/** Identifies one Room record (see `src/types.ts` for the brand rationale). */
export type RoomId = RoomIdBrand

/** Identifies one room message record (see `src/types.ts` for the brand rationale). */
export type RoomMessageId = RoomMessageIdBrand

/**
 * Brand a string as a {@link RoomId}.
 * @param id - Raw room id string.
 * @returns the same string, branded at compile time.
 */
export function RoomId(id: string): RoomId {
  return id as RoomId
}

/**
 * Brand a string as a {@link RoomMessageId}.
 * @param id - Raw message id string.
 * @returns the same string, branded at compile time.
 */
export function RoomMessageId(id: string): RoomMessageId {
  return id as RoomMessageId
}

/** One durable change in the room domain, published to subscribers after the write succeeds. */
export type RoomChange =
  | { readonly kind: 'room-upsert'; readonly room: Room }
  | { readonly kind: 'room-remove'; readonly roomId: RoomId }
  | { readonly kind: 'message'; readonly message: RoomMessage }

declare module '@deepseek-ai/cordis' {
  interface Context {
    botRooms: BotRooms
  }
}

/**
 * Durable room registry. Startup waits for the storage domain, opens the
 * room domain, and rebuilds the room and message caches; every mutation is
 * validated against the Bot roster before it reaches the store, and each
 * committed change is published to subscribers for state transport. The
 * registry also owns the room router: posting a message delivers it into the
 * addressed member Bots' own conversations and folds their replies back into
 * the log.
 */
export class BotRooms extends Service {
  static inject = ['storageDomain', 'bots', 'sessionController']

  private store?: BotRoomStore
  private delivery?: BotRoomDelivery
  private readonly listeners = new Set<(change: RoomChange) => void>()

  constructor(ctx: Context) {
    super(ctx, 'botRooms')
  }

  /**
   * Open the room domain, rebuild both caches from durable state, and start
   * routing delivered replies from member Bot conversations.
   */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(roomDomainSpec)
    this.ctx.effect(() => () => domain.close(), 'bot-room.domainClose')
    this.store = new BotRoomStore(domain.table('rooms'), domain.table('messages'))
    this.delivery = new BotRoomDelivery(this.ctx)
    this.ctx.effect(() => {
      this.ctx.on('session/event', (session, event) => {
        this.delivery?.observeSessionEvent(session, event)
      })
      return () => { this.delivery?.dispose() }
    }, 'bot-room.delivery')
  }

  /**
   * Post one message into a room: append it to the log, resolve its
   * audience, and deliver to each addressed member.
   * @param roomId - Room receiving the message.
   * @param text - Message body, parsed for mentions as authored.
   * @param author - Who is speaking.
   * @returns the appended room message.
   */
  async post(roomId: RoomId, text: string, author: RoomPostAuthor): Promise<RoomMessage> {
    return await this.requireDelivery().post(roomId, text, author)
  }

  /**
   * Subscribe to per-Bot working state for the room UI.
   * @param listener - Called on each state transition.
   * @returns the unsubscribe function.
   */
  subscribeActivity(listener: (activity: RoomActivity) => void): () => void {
    return this.requireDelivery().subscribeActivity(listener)
  }

  /**
   * Create one durable Room over a roster of registered Bots.
   * @param profile - Room name and member Bots.
   * @returns the newly durable Room.
   * @throws BotRoomUnknownBotError when a member Bot is unregistered.
   * @throws BotRoomInvalidError when a field fails validation.
   */
  async create(profile: RoomProfile): Promise<Room> {
    this.requireKnownBots(profile.memberIds)
    const room = await this.requireStore().create(profile)
    this.publish({ kind: 'room-upsert', room })
    return room
  }

  /**
   * Look up a Room by id.
   * @param id - Room id.
   * @returns the Room, or `undefined` when unknown.
   */
  get(id: RoomId): Room | undefined {
    return this.requireStore().get(id)
  }

  /**
   * List every room, newest first.
   * @returns a fresh ordered array of rooms.
   */
  list(): Room[] {
    return this.requireStore().list()
  }

  /**
   * Delete one Room together with its message log.
   * @param id - Room to remove.
   * @returns `true` when a room was deleted, `false` when it was unknown.
   */
  async delete(id: RoomId): Promise<boolean> {
    const deleted = await this.requireStore().delete(id)
    if (deleted) this.publish({ kind: 'room-remove', roomId: id })
    return deleted
  }

  /**
   * Add one registered Bot to a room.
   * @param id - Room to edit.
   * @param botId - Bot to add.
   * @returns the Room after the edit.
   * @throws BotRoomUnknownBotError when the Bot is unregistered.
   * @throws BotRoomInvalidError when the Bot is already a member or the room is full.
   */
  async addMember(id: RoomId, botId: BotId): Promise<Room> {
    this.requireKnownBots([botId])
    const room = await this.requireStore().addMember(id, botId)
    this.publish({ kind: 'room-upsert', room })
    return room
  }

  /**
   * Rename one room. Membership and the message log are untouched.
   * @param id - Room to rename.
   * @param name - New display name.
   * @returns the Room after the edit.
   * @throws BotRoomNotFoundError when the room is unknown.
   * @throws BotRoomInvalidError when the name fails validation.
   */
  async rename(id: RoomId, name: string): Promise<Room> {
    const room = await this.requireStore().rename(id, name)
    this.publish({ kind: 'room-upsert', room })
    return room
  }

  /**
   * Remove one Bot from a room.
   * @param id - Room to edit.
   * @param botId - Bot to remove.
   * @returns the Room after the edit.
   * @throws BotRoomInvalidError when the Bot is absent or the room would drop below its floor.
   */
  async removeMember(id: RoomId, botId: BotId): Promise<Room> {
    const room = await this.requireStore().removeMember(id, botId)
    this.publish({ kind: 'room-upsert', room })
    return room
  }

  /**
   * Append one message to a room's log.
   * @param profile - Author, body, and mentioned members.
   * @returns the newly durable message.
   * @throws BotRoomNotFoundError when the room is unknown.
   * @throws BotRoomInvalidError when a field fails validation.
   */
  async appendMessage(profile: RoomMessageProfile): Promise<RoomMessage> {
    const message = await this.requireStore().appendMessage(profile)
    this.publish({ kind: 'message', message })
    return message
  }

  /**
   * Read a room's message log in append order.
   * @param roomId - Room whose log is read.
   * @param limit - Keep only the newest `limit` messages; omitted reads the whole log.
   * @returns a fresh array in append order.
   */
  messages(roomId: RoomId, limit?: number): RoomMessage[] {
    return this.requireStore().messages(roomId, limit)
  }

  /**
   * Durable message count of one room.
   * @param roomId - Room to count.
   * @returns the number of recorded messages.
   */
  messageCount(roomId: RoomId): number {
    return this.requireStore().messageCount(roomId)
  }

  /**
   * Resolve a room's members against the live roster. A member whose Bot
   * record is gone keeps its id as the display name, so the room still
   * renders and the membership can be repaired deliberately.
   * @param room - Room whose members are resolved.
   * @returns members in join order.
   */
  describeMembers(room: Room): RoomMember[] {
    return room.memberIds.map((botId) => {
      const bot = this.ctx.bots.get(botId)
      return { botId, name: bot?.name ?? String(botId) }
    })
  }

  /**
   * Subscribe to committed room changes.
   * @param listener - Called after each committed change.
   * @returns the unsubscribe function.
   */
  subscribe(listener: (change: RoomChange) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private publish(change: RoomChange): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(change)
      } catch (error) {
        this.ctx.logger.warn(`room change listener failed: ${String(error)}`)
      }
    }
  }

  private requireKnownBots(memberIds: readonly BotId[]): void {
    for (const botId of memberIds) {
      if (this.ctx.bots.get(botId) === undefined) throw new BotRoomUnknownBotError(botId)
    }
  }

  private requireStore(): BotRoomStore {
    if (this.store === undefined) throw new Error('Bot rooms are not started yet')
    return this.store
  }

  private requireDelivery(): BotRoomDelivery {
    if (this.delivery === undefined) throw new Error('Bot rooms are not started yet')
    return this.delivery
  }
}

export default BotRooms
