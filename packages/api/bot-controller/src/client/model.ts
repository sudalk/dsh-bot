/** Client-side Bot state model shared by Remote transport and UI projection. */

import { notifySubscribers } from '@deepseek-ai/dsh-client-store'
import type {} from '@deepseek-ai/dsh-api-bot-controller/remote'
import type { RemoteResult, TypertClientRemote } from '@deepseek-ai/dsh-typert-protocol'
import type {
  BotCreateRequest, BotCreateValue, BotDeleteRequest, BotDeleteValue, BotFollowIncrement,
  BotId, BotInsertBeforeRequest, BotOrderValue, BotUpdateRequest, BotValue, BotView,
  RoomFollowIncrement, RoomId, RoomMessageView, RoomView,
} from '../types.ts'

/** Complete generated `ctx.remote.bot` namespace. */
export type BotRemote = TypertClientRemote['bot']

/** Immutable Bot roster state. */
export interface BotSnapshot {
  readonly bots: readonly BotView[]
  readonly state: 'idle' | 'loading' | 'error'
  readonly phase: 'pending' | 'ready'
  readonly error: unknown
}

/** Client-side operations emitted by one decoded follow generation. */
export interface BotClientFollowSink {
  replaceBaseline(bots: readonly BotView[]): void
  upsert(bot: BotView): void
  remove(botId: BotId): void
  replaceOrder(botIds: readonly BotId[]): void
}

/**
 * Shared snapshot bookkeeping for one client-side streamed collection: the
 * loading lifecycle, the lazily rebuilt immutable snapshot, and the listener
 * set every model exposes to React.
 */
abstract class ClientCollectionModel<Snapshot> {
  protected state: 'idle' | 'loading' | 'error' = 'loading'
  protected phase: 'pending' | 'ready' = 'pending'
  protected error: unknown = null
  private readonly listeners = new Set<() => void>()
  private snapshotCache: Snapshot | undefined
  private snapshotDirty = true

  /** Build the current immutable snapshot from this model's own fields. */
  protected abstract buildSnapshot(): Snapshot

  /**
   * Publish a failed state after the stream carrier gave up.
   * @param error - Failure to surface to consumers.
   */
  handleStreamFailure(error: unknown): void {
    this.state = 'error'
    this.error = error
    this.notify()
  }

  /**
   * Current immutable snapshot, rebuilt lazily after each change.
   * @returns the snapshot consumers render.
   */
  getSnapshot(): Snapshot {
    if (this.snapshotDirty || this.snapshotCache === undefined) {
      this.snapshotDirty = false
      this.snapshotCache = this.buildSnapshot()
    }
    return this.snapshotCache
  }

  /**
   * Subscribe to model changes.
   * @param listener - Called after every published change.
   * @returns the unsubscribe function.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  protected notify(): void {
    this.snapshotDirty = true
    notifySubscribers(this.listeners, '[bot-controller]')
  }
}

/** Client Bot projection over the Remote namespace. */
export class ClientBotModel extends ClientCollectionModel<BotSnapshot> implements BotClientFollowSink {
  private bots: readonly BotView[] = []

  constructor(private readonly remote: BotRemote) {
    super()
  }

  /**
   * Create a Bot on the Host and fold the authoritative row into the cache.
   * @param request - Complete Bot profile.
   * @returns the Remote result carrying the created Bot.
   */
  async create(request: BotCreateRequest): Promise<RemoteResult<BotCreateValue>> {
    const result = await this.remote.create(request)
    if (result.ok) this.upsert(result.value.bot)
    return result
  }

  /**
   * Replace a Bot's mutable profile on the Host and fold the row into the cache.
   * @param request - Bot identity and fields to replace.
   * @returns the Remote result carrying the authoritative Bot.
   */
  async update(request: BotUpdateRequest): Promise<RemoteResult<BotValue>> {
    const result = await this.remote.update(request)
    if (result.ok) this.upsert(result.value.bot)
    return result
  }

  /**
   * Delete a Bot on the Host and drop its cache entry.
   * @param request - Bot to remove.
   * @returns the Remote result carrying the deletion acknowledgement.
   */
  async delete(request: BotDeleteRequest): Promise<RemoteResult<BotDeleteValue>> {
    const result = await this.remote.delete(request)
    if (result.ok) this.remove(request.botId)
    return result
  }

  /**
   * Move a Bot within the roster order on the Host and adopt the committed order.
   * @param request - Bot to move and its optional anchor.
   * @returns the Remote result carrying the complete order.
   */
  async insertBefore(request: BotInsertBeforeRequest): Promise<RemoteResult<BotOrderValue>> {
    const result = await this.remote.insertBefore(request)
    if (result.ok) this.replaceOrder(result.value.botIds)
    return result
  }

  replaceBaseline(bots: readonly BotView[]): void {
    this.bots = [...bots]
    this.state = 'idle'
    this.phase = 'ready'
    this.error = null
    this.notify()
  }

  upsert(bot: BotView): void {
    const index = this.bots.findIndex(existing => String(existing.botId) === String(bot.botId))
    if (index < 0) this.bots = [bot, ...this.bots]
    else {
      const next = [...this.bots]
      next[index] = bot
      this.bots = next
    }
    this.notify()
  }

  remove(botId: BotId): void {
    this.bots = this.bots.filter(bot => String(bot.botId) !== String(botId))
    this.notify()
  }

  replaceOrder(botIds: readonly BotId[]): void {
    const byId = new Map(this.bots.map(bot => [String(bot.botId), bot]))
    const bots = botIds.map(id => byId.get(String(id))).filter(bot => bot !== undefined)
    if (bots.length === byId.size) this.bots = bots
    this.notify()
  }

  /**
   * Apply one increment frame to the cache.
   * @param frame - Decoded change after the opening baseline.
   */
  acceptIncrement(frame: BotFollowIncrement): void {
    switch (frame.type) {
      case 'upsert': this.upsert(frame.bot); return
      case 'remove': this.remove(frame.botId); return
      case 'order': this.replaceOrder(frame.botIds)
    }
  }

  protected buildSnapshot(): BotSnapshot {
    return {
      bots: this.bots,
      state: this.state,
      phase: this.phase,
      error: this.error,
    }
  }
}

/** Immutable room roster state. */
export interface RoomSnapshot {
  readonly rooms: readonly RoomView[]
  readonly state: 'idle' | 'loading' | 'error'
  readonly phase: 'pending' | 'ready'
  readonly error: unknown
}

/** Client-side operations emitted by one decoded room stream generation. */
export interface RoomClientFollowSink {
  replaceBaseline(rooms: readonly RoomView[]): void
  upsert(room: RoomView): void
  remove(roomId: RoomId): void
  appendMessage(message: RoomMessageView): void
  setActivity(roomId: RoomId, botId: BotId, state: 'working' | 'idle'): void
}

/**
 * Client room projection over the Remote namespace. Rooms arrive through the
 * stream; a room's message log is fetched once when the room is opened and
 * then extended by the stream's message frames, so an open room always shows
 * the conversation live.
 */
export class ClientRoomModel extends ClientCollectionModel<RoomSnapshot> implements RoomClientFollowSink {
  private rooms: readonly RoomView[] = []
  private readonly messages = new Map<string, readonly RoomMessageView[]>()
  private readonly working = new Map<string, ReadonlySet<string>>()

  /** @param remote - Generated Bot namespace carrying the room methods. */
  constructor(private readonly remote: BotRemote) {
    super()
  }

  /**
   * Load one room's durable log into the cache, replacing whatever the
   * stream had accumulated for it.
   * @param roomId - Room whose log is loaded.
   * @returns the loaded messages.
   */
  async loadMessages(roomId: RoomId): Promise<readonly RoomMessageView[]> {
    const result = await this.remote.roomsMessages({ roomId })
    if (!result.ok) throw new Error(`room messages failed: ${result.error.code}: ${result.error.message}`)
    this.messages.set(String(roomId), result.value.messages)
    this.notify()
    return result.value.messages
  }

  /**
   * Message log currently cached for one room.
   * @param roomId - Room whose log is read.
   * @returns the cached messages in append order.
   */
  getMessages(roomId: RoomId): readonly RoomMessageView[] {
    return this.messages.get(String(roomId)) ?? []
  }

  /**
   * Member Bots currently working in one room.
   * @param roomId - Room whose activity is read.
   * @returns the ids of members with at least one delivery in flight.
   */
  getWorking(roomId: RoomId): ReadonlySet<string> {
    return this.working.get(String(roomId)) ?? EMPTY_IDS
  }

  replaceBaseline(rooms: readonly RoomView[]): void {
    this.rooms = [...rooms]
    this.state = 'idle'
    this.phase = 'ready'
    this.error = null
    this.notify()
  }

  upsert(room: RoomView): void {
    const index = this.rooms.findIndex(existing => String(existing.roomId) === String(room.roomId))
    if (index < 0) this.rooms = [room, ...this.rooms]
    else {
      const next = [...this.rooms]
      next[index] = room
      this.rooms = next
    }
    this.notify()
  }

  remove(roomId: RoomId): void {
    this.rooms = this.rooms.filter(room => String(room.roomId) !== String(roomId))
    this.messages.delete(String(roomId))
    this.working.delete(String(roomId))
    this.notify()
  }

  appendMessage(message: RoomMessageView): void {
    const roomKey = String(message.roomId)
    const current = this.messages.get(roomKey)
    // A log fetched after the message already arrived must not duplicate it.
    if (current !== undefined && current.some(entry => String(entry.messageId) === String(message.messageId))) return
    this.messages.set(roomKey, [...current ?? [], message])
    this.notify()
  }

  setActivity(roomId: RoomId, botId: BotId, state: 'working' | 'idle'): void {
    const roomKey = String(roomId)
    const next = new Set(this.working.get(roomKey) ?? [])
    if (state === 'working') next.add(String(botId))
    else next.delete(String(botId))
    if (next.size === 0) this.working.delete(roomKey)
    else this.working.set(roomKey, next)
    this.notify()
  }

  /**
   * Apply one increment frame to the cache.
   * @param frame - Decoded change after the opening baseline.
   */
  acceptIncrement(frame: RoomFollowIncrement): void {
    switch (frame.type) {
      case 'room-upsert': this.upsert(frame.room); return
      case 'room-remove': this.remove(frame.roomId); return
      case 'message': this.appendMessage(frame.message); return
      case 'activity': this.setActivity(frame.roomId, frame.botId, frame.state)
    }
  }

  protected buildSnapshot(): RoomSnapshot {
    return {
      rooms: this.rooms,
      state: this.state,
      phase: this.phase,
      error: this.error,
    }
  }
}

const EMPTY_IDS: ReadonlySet<string> = new Set()
