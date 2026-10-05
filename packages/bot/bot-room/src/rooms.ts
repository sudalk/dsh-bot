/**
 * Durable room store: validated room records plus the append-only message
 * log that is the room's shared transcript. Writes go through each table's
 * typed path, which is what the domain's `domain/changed` observer and the
 * package invariant see; reads are the in-memory caches rebuilt at open.
 * @module @deepseek-ai/dsh-bot-room/src/rooms
 */

import { randomUUID } from 'node:crypto'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { BotId } from '@deepseek-ai/dsh-bot/types'
import { ROOM_MEMBERS_MAX, ROOM_MEMBERS_MIN, ROOM_MESSAGE_MAX_CHARS, ROOM_NAME_MAX_CHARS } from './limits.ts'
import type { RoomRecord, RoomMessageRecord } from './spec.ts'
import type {
  Room, RoomId, RoomMessage, RoomMessageId, RoomMessageProfile, RoomMessageValidation,
  RoomProfile, RoomProfileValidation,
} from './types.ts'

/** A create or update request carried a room profile that fails validation. Nothing was written. */
export class BotRoomInvalidError extends Error {
  /**
   * @param reason - Which field failed and why.
   */
  constructor(readonly reason: string) {
    super(`invalid room profile: ${reason}`)
    this.name = 'BotRoomInvalidError'
  }
}

/** A request named a Room the store does not hold. Nothing was written. */
export class BotRoomNotFoundError extends Error {
  /**
   * @param roomId - The unknown room id.
   */
  constructor(readonly roomId: RoomId) {
    super(`no Room '${roomId}' is registered`)
    this.name = 'BotRoomNotFoundError'
  }
}

/** A room profile named a Bot the roster does not hold. Nothing was written. */
export class BotRoomUnknownBotError extends Error {
  /**
   * @param botId - The unknown Bot id.
   */
  constructor(readonly botId: BotId) {
    super(`no Bot '${botId}' is registered`)
    this.name = 'BotRoomUnknownBotError'
  }
}

/**
 * Validate a proposed room profile before any write. Message-independent so a
 * caller may preflight a form without touching durable state.
 * @param profile - Fields to validate; omission is checked by the caller.
 * @returns `{ ok: true }`, or `{ ok: false, reason }` naming the first failure.
 */
export function validateRoomProfile(profile: Partial<RoomProfile>): RoomProfileValidation {
  if (profile.name !== undefined && profile.name.trim() === '') {
    return { ok: false, reason: 'name must not be blank' }
  }
  if (profile.name !== undefined && profile.name !== profile.name.trim()) {
    return { ok: false, reason: 'name must not have surrounding whitespace' }
  }
  if (profile.name !== undefined && profile.name.length > ROOM_NAME_MAX_CHARS) {
    return { ok: false, reason: `name must be at most ${ROOM_NAME_MAX_CHARS} characters` }
  }
  if (profile.memberIds !== undefined) {
    if (profile.memberIds.length < ROOM_MEMBERS_MIN) {
      return { ok: false, reason: `memberIds must name at least ${ROOM_MEMBERS_MIN} Bots` }
    }
    if (profile.memberIds.length > ROOM_MEMBERS_MAX) {
      return { ok: false, reason: `memberIds must name at most ${ROOM_MEMBERS_MAX} Bots` }
    }
    const seen = new Set(profile.memberIds.map(String))
    if (seen.size !== profile.memberIds.length) {
      return { ok: false, reason: 'memberIds must not repeat a Bot' }
    }
    if (profile.memberIds.some(id => String(id).trim() === '')) {
      return { ok: false, reason: 'memberIds must not contain a blank id' }
    }
  }
  return { ok: true }
}

/**
 * Validate one proposed room message before any write.
 * @param profile - Fields to validate; omission is checked by the caller.
 * @returns `{ ok: true }`, or `{ ok: false, reason }` naming the first failure.
 */
export function validateRoomMessage(profile: Partial<RoomMessageProfile>): RoomMessageValidation {
  if (profile.text !== undefined && profile.text.trim() === '') {
    return { ok: false, reason: 'text must not be blank' }
  }
  if (profile.text !== undefined && profile.text.length > ROOM_MESSAGE_MAX_CHARS) {
    return { ok: false, reason: `text must be at most ${ROOM_MESSAGE_MAX_CHARS} characters` }
  }
  if (profile.senderKind === 'bot' && (profile.senderId === undefined || String(profile.senderId).trim() === '')) {
    return { ok: false, reason: 'senderId must name the authoring Bot' }
  }
  if (profile.senderKind !== undefined && profile.senderKind !== 'bot' && profile.senderId !== undefined) {
    return { ok: false, reason: 'senderId is only valid for a Bot author' }
  }
  return { ok: true }
}

/**
 * Durable room store over one `rooms` table and one `messages` table. Room
 * mutations are serialized through a single queue so a membership edit and a
 * racing create cannot interleave their read-modify-write of the same record.
 */
export class BotRoomStore {
  private readonly records = new Map<RoomId, RoomRecord>()
  private readonly logs = new Map<RoomId, RoomMessage[]>()
  private operationTail: Promise<void> = Promise.resolve()

  /**
   * @param rooms - The open `rooms` table.
   * @param messagesTable - The open `messages` table.
   */
  constructor(
    private readonly rooms: KvTable<RoomId, RoomRecord>,
    private readonly messagesTable: KvTable<RoomMessageId, RoomMessageRecord>,
  ) {
    for (const [id, record] of rooms.entries()) {
      this.records.set(id, record)
    }
    for (const [id, record] of messagesTable.entries()) {
      const log = this.logs.get(record.roomId) ?? []
      log.push({
        id,
        roomId: record.roomId,
        senderKind: record.senderKind,
        ...record.senderId === undefined ? {} : { senderId: record.senderId as BotId },
        senderName: record.senderName,
        text: record.text,
        mentions: record.mentions,
        createdAt: record.createdAt,
      })
      this.logs.set(record.roomId, log)
    }
  }

  /**
   * Create one durable Room. The name and member roster are validated first;
   * the record is cached before the durable put so a failing write rolls the
   * cache back rather than publishing a room the medium lacks.
   * @param profile - Complete room identity.
   * @returns the newly durable Room.
   * @throws BotRoomInvalidError when a field fails validation.
   */
  create(profile: RoomProfile): Promise<Room> {
    const validation = validateRoomProfile(profile)
    if (!validation.ok) throw new BotRoomInvalidError(validation.reason)
    return this.enqueue(async () => {
      const now = new Date().toISOString()
      const id = randomUUID() as RoomId
      const record: RoomRecord = {
        name: profile.name,
        memberIds: [...profile.memberIds],
        createdAt: now,
        updatedAt: now,
      }
      this.records.set(id, record)
      try {
        await this.rooms.put(id, record)
      } catch (error) {
        this.records.delete(id)
        throw error
      }
      return this.project(id, record)
    })
  }

  /**
   * Look up a Room by id.
   * @param id - Room id.
   * @returns the Room, or `undefined` when unknown.
   */
  get(id: RoomId): Room | undefined {
    const record = this.records.get(id)
    return record === undefined ? undefined : this.project(id, record)
  }

  /**
   * Synchronous projection of every room, newest first. Rooms created within
   * one clock tick share a timestamp, so insertion order breaks the tie: the
   * record map preserves insertion order and the sort is newest-first.
   * @returns a fresh ordered array of rooms.
   */
  list(): Room[] {
    return [...this.records.entries()]
      .map(([id, record], index) => ({ room: this.project(id, record), index }))
      .sort((left, right) =>
        right.room.createdAt.localeCompare(left.room.createdAt) || right.index - left.index)
      .map(entry => entry.room)
  }

  /**
   * Rename one Room. The member roster and the message log are untouched.
   * @param id - Room to rename.
   * @param name - New display name.
   * @returns the Room after the edit.
   * @throws BotRoomNotFoundError when the room is unknown.
   * @throws BotRoomInvalidError when the name fails validation.
   */
  rename(id: RoomId, name: string): Promise<Room> {
    const validation = validateRoomProfile({ name })
    if (!validation.ok) throw new BotRoomInvalidError(validation.reason)
    return this.enqueue(async () => {
      const record = this.records.get(id)
      if (record === undefined) throw new BotRoomNotFoundError(id)
      if (record.name === name) return this.project(id, record)
      const updated: RoomRecord = { ...record, name, updatedAt: new Date().toISOString() }
      this.records.set(id, updated)
      try {
        await this.rooms.put(id, updated)
      } catch (error) {
        this.records.set(id, record)
        throw error
      }
      return this.project(id, updated)
    })
  }

  /**
   * Delete one Room record together with its message log. No other room's
   * records are touched.
   * @param id - Room to remove.
   * @returns `true` when a record was deleted, `false` when it was unknown.
   */
  delete(id: RoomId): Promise<boolean> {
    return this.enqueue(async () => {
      const record = this.records.get(id)
      if (record === undefined) return false
      const log = this.logs.get(id) ?? []
      this.records.delete(id)
      this.logs.delete(id)
      try {
        await this.rooms.delete(id)
        for (const message of log) await this.messagesTable.delete(message.id)
      } catch (error) {
        this.records.set(id, record)
        if (log.length > 0) this.logs.set(id, log)
        throw error
      }
      return true
    })
  }

  /**
   * Add one Bot to a room's roster. The membership bound is enforced here so
   * no caller can grow a room past {@link ROOM_MEMBERS_MAX}.
   * @param id - Room to edit.
   * @param botId - Bot to add.
   * @returns the Room after the edit.
   * @throws BotRoomNotFoundError when the room is unknown.
   * @throws BotRoomInvalidError when the Bot is already a member or the room is full.
   */
  addMember(id: RoomId, botId: BotId): Promise<Room> {
    return this.mutateMembers(id, (memberIds) => {
      if (memberIds.some(member => String(member) === String(botId))) {
        return { ok: false, reason: `Bot '${botId}' is already a member` }
      }
      if (memberIds.length >= ROOM_MEMBERS_MAX) {
        return { ok: false, reason: `memberIds must name at most ${ROOM_MEMBERS_MAX} Bots` }
      }
      return { ok: true, memberIds: [...memberIds, botId] }
    })
  }

  /**
   * Remove one Bot from a room's roster.
   * @param id - Room to edit.
   * @param botId - Bot to remove.
   * @returns the Room after the edit.
   * @throws BotRoomNotFoundError when the room is unknown.
   * @throws BotRoomInvalidError when the Bot is absent or the room would drop below its floor.
   */
  removeMember(id: RoomId, botId: BotId): Promise<Room> {
    return this.mutateMembers(id, (memberIds) => {
      if (!memberIds.some(member => String(member) === String(botId))) {
        return { ok: false, reason: `Bot '${botId}' is not a member` }
      }
      if (memberIds.length - 1 < ROOM_MEMBERS_MIN) {
        return { ok: false, reason: `memberIds must name at least ${ROOM_MEMBERS_MIN} Bots` }
      }
      return { ok: true, memberIds: memberIds.filter(member => String(member) !== String(botId)) }
    })
  }

  /**
   * Append one message to a room's log. The room must exist; the message is
   * cached before the durable put so a failing write rolls the cache back.
   * @param profile - Complete message identity.
   * @returns the newly durable message.
   * @throws BotRoomNotFoundError when the room is unknown.
   * @throws BotRoomInvalidError when a field fails validation.
   */
  appendMessage(profile: RoomMessageProfile): Promise<RoomMessage> {
    const validation = validateRoomMessage(profile)
    if (!validation.ok) throw new BotRoomInvalidError(validation.reason)
    return this.enqueue(async () => {
      if (!this.records.has(profile.roomId)) throw new BotRoomNotFoundError(profile.roomId)
      const id = randomUUID() as RoomMessageId
      const record: RoomMessageRecord = {
        roomId: profile.roomId,
        senderKind: profile.senderKind,
        ...profile.senderId === undefined ? {} : { senderId: String(profile.senderId) },
        senderName: profile.senderName,
        text: profile.text,
        mentions: [...profile.mentions.map(String)] as BotId[],
        createdAt: new Date().toISOString(),
      }
      const message: RoomMessage = {
        id,
        roomId: profile.roomId,
        senderKind: profile.senderKind,
        ...profile.senderId === undefined ? {} : { senderId: profile.senderId },
        senderName: profile.senderName,
        text: profile.text,
        mentions: [...profile.mentions],
        createdAt: record.createdAt,
      }
      const log = this.logs.get(profile.roomId) ?? []
      log.push(message)
      this.logs.set(profile.roomId, log)
      try {
        await this.messagesTable.put(id, record)
      } catch (error) {
        log.pop()
        throw error
      }
      return message
    })
  }

  /**
   * Read a room's message log in append order.
   * @param roomId - Room whose log is read.
   * @param limit - Keep only the newest `limit` messages; omitted reads the whole log.
   * @returns a fresh array in append order.
   */
  messages(roomId: RoomId, limit?: number): RoomMessage[] {
    const log = this.logs.get(roomId) ?? []
    const kept = limit === undefined || limit >= log.length ? log : log.slice(log.length - limit)
    return [...kept]
  }

  /**
   * Durable message count of one room, without copying its log.
   * @param roomId - Room to count.
   * @returns the number of messages recorded for that room.
   */
  messageCount(roomId: RoomId): number {
    return this.logs.get(roomId)?.length ?? 0
  }

  private mutateMembers(
    id: RoomId,
    next: (memberIds: readonly BotId[]) => MemberEdit,
  ): Promise<Room> {
    return this.enqueue(async () => {
      const record = this.records.get(id)
      if (record === undefined) throw new BotRoomNotFoundError(id)
      const edit = next(record.memberIds)
      if (!edit.ok) throw new BotRoomInvalidError(edit.reason)
      const updated: RoomRecord = { ...record, memberIds: [...edit.memberIds], updatedAt: new Date().toISOString() }
      this.records.set(id, updated)
      try {
        await this.rooms.put(id, updated)
      } catch (error) {
        this.records.set(id, record)
        throw error
      }
      return this.project(id, updated)
    })
  }

  private project(id: RoomId, record: RoomRecord): Room {
    return {
      id,
      name: record.name,
      memberIds: [...record.memberIds],
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationTail.then(operation)
    this.operationTail = result.then(() => {}, () => {})
    return result
  }
}

/** Outcome of one membership edit: the next roster, or the reason it is refused. */
type MemberEdit =
  | { readonly ok: true; readonly memberIds: readonly BotId[] }
  | { readonly ok: false; readonly reason: string }
