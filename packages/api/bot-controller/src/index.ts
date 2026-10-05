/** Host Bot Remote owner: explicit commands, roster-follow state, and Bot identity. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type { RoomActivity, RoomChange } from '@deepseek-ai/dsh-bot-room'
import { Deque } from '@deepseek-ai/dsh-deque'
import type { DomainChanged } from '@deepseek-ai/dsh-storage-domain'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { Bot, BotId, BotRecord } from '@deepseek-ai/dsh-bot'
import type { Room, RoomMember, RoomMessage } from '@deepseek-ai/dsh-bot-room'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  BotConversationRequest, BotConversationValue,
  BotCreateRequest, BotCreateValue, BotDeleteRequest, BotDeleteValue, BotFollowFrame,
  BotInsertBeforeRequest, BotOrderValue, BotRoomCreateRequest, BotRoomDeleteRequest, BotRoomDeleteValue,
  BotRoomGetRequest, BotRoomMemberRequest, BotRoomMessagesRequest, BotRoomMessagesValue,
  BotRoomPostRequest, BotRoomPostValue, BotRoomRenameRequest, BotRoomValue,
  BotRoomsValue, BotUpdateRequest, BotValue, BotView, RoomFollowFrame, RoomFollowIncrement,
  RoomMessageView, RoomView,
} from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host Bot business API and Remote namespace owner. */
    botController: BotController
  }
}

/**
 * Host service backing the generated `ctx.remote.bot` namespace. Mutations
 * return the complete authoritative row; the streams emit a full baseline and
 * then one increment per durable change. It also owns the Bot identity and
 * the room router: a Session that is some Bot's continuing conversation
 * composes with that Bot's name and role as its persona, installed on the
 * Agent's own scope so the deployment prompt is untouched for every other
 * Session, and one room message is delivered into each addressed Bot's own
 * conversation with the reply folded back into the room log.
 */
export class BotController extends TypertRemoteService {
  static inject = ['typert', 'bots', 'botRooms', 'sessionController', 'agents']

  private readonly followers = new Set<FrameFollower<BotFollowFrame>>()
  private readonly roomFollowers = new Set<FrameFollower<RoomFollowFrame>>()

  constructor(ctx: Context) {
    super(ctx, 'botController', { namespace: 'bot' })
    ctx.on('domain/changed', (change: DomainChanged) => { this.changed(change) })
    ctx.effect(() => ctx.botRooms.subscribe((change) => { this.publishRoomChange(change) }), 'bot-controller.room-feed')
    ctx.effect(() => ctx.botRooms.subscribeActivity((activity) => { this.publishActivity(activity) }), 'bot-controller.room-activity')
    ctx.effect(() => () => {
      for (const follower of this.followers) follower.close()
      this.followers.clear()
      for (const follower of this.roomFollowers) follower.close()
      this.roomFollowers.clear()
    }, 'bot-controller.feed')
  }

  /**
   * Resolve one Bot's continuing conversation, creating it on the first ask.
   * Concurrent asks for the same Bot share one creation, so a double click
   * cannot leave a second orphan Session behind.
   * @param request - Bot whose continuing conversation is being opened.
   * @returns the authoritative Bot and the conversation Session it holds.
   */
  @Remote('ensureConversation')
  async ensureConversation(request: BotConversationRequest): Promise<BotConversationValue> {
    const bot = this.ctx.bots.get(request.botId)
    if (bot === undefined) {
      throw new RemoteError('bot/not-found', `Bot "${String(request.botId)}" not found`, {
        botId: request.botId,
      })
    }
    const sessionId = await bot.ensureConversation()
    return { bot: botView(bot), sessionId }
  }

  /**
   * Create a Bot from a complete profile.
   * @param request - Complete Bot profile.
   * @returns the created Bot projection.
   */
  @Remote('create')
  async create(request: BotCreateRequest): Promise<BotCreateValue> {
    const bot = await this.ctx.bots.create(request)
    return { bot: botView(bot) }
  }

  /**
   * Replace the mutable profile fields of one Bot.
   * @param request - Bot identity and fields to replace.
   * @returns the authoritative Bot after the update.
   */
  @Remote('update')
  async update(request: BotUpdateRequest): Promise<BotValue> {
    const { botId, ...update } = request
    await this.ctx.bots.update(botId, update)
    const bot = this.ctx.bots.get(botId)
    if (bot === undefined) throw new Error(`Bot '${String(botId)}' disappeared after update`)
    return { bot: botView(bot) }
  }

  /**
   * Delete one Bot record from the roster.
   * @param request - Bot to remove.
   * @returns the deletion acknowledgement.
   */
  @Remote('delete')
  async delete(request: BotDeleteRequest): Promise<BotDeleteValue> {
    await this.ctx.bots.delete(request.botId)
    return { deleted: true }
  }

  /**
   * Move one Bot within the roster order.
   * @param request - Bot to move and its optional anchor.
   * @returns the committed roster order.
   */
  @Remote('insertBefore')
  async insertBefore(request: BotInsertBeforeRequest): Promise<BotOrderValue> {
    const botIds = await this.ctx.bots.insertBefore(request.botId, request.beforeBotId)
    return { botIds }
  }

  /**
   * List every durable room, newest first.
   * @returns every recorded room.
   */
  @Remote('roomsList')
  roomsList(): Promise<BotRoomsValue> {
    return Promise.resolve({ rooms: this.ctx.botRooms.list().map(room => this.roomView(room)) })
  }

  /**
   * Create one room over a roster of registered Bots. The room owns its
   * message log; no Session is created here.
   * @param request - Room name and member Bots.
   * @returns the created room.
   */
  @Remote('roomsCreate')
  async roomsCreate(request: BotRoomCreateRequest): Promise<BotRoomValue> {
    const room = await this.ctx.botRooms.create({ name: request.name, memberIds: request.memberIds })
    return { room: this.roomView(room) }
  }

  /**
   * Resolve one room by id.
   * @param request - Room to resolve.
   * @returns the recorded room.
   */
  @Remote('roomsGet')
  roomsGet(request: BotRoomGetRequest): Promise<BotRoomValue> {
    const room = this.ctx.botRooms.get(request.roomId)
    if (room === undefined) {
      return Promise.reject(new RemoteError(
        'bot/room-not-found',
        `Room "${String(request.roomId)}" not found`,
        { roomId: request.roomId },
      ))
    }
    return Promise.resolve({ room: this.roomView(room) })
  }

  /**
   * Delete one room and its message log. Member Bots and their conversations
   * are untouched.
   * @param request - Room to remove.
   * @returns the deletion acknowledgement.
   */
  @Remote('roomsDelete')
  async roomsDelete(request: BotRoomDeleteRequest): Promise<BotRoomDeleteValue> {
    const deleted = await this.ctx.botRooms.delete(request.roomId)
    if (!deleted) {
      throw new RemoteError('bot/room-not-found', `Room "${String(request.roomId)}" not found`, {
        roomId: request.roomId,
      })
    }
    return { deleted: true }
  }

  /**
   * Add one Bot to a room.
   * @param request - Room and Bot to add.
   * @returns the room after the edit.
   */
  @Remote('roomsAddMember')
  async roomsAddMember(request: BotRoomMemberRequest): Promise<BotRoomValue> {
    const room = await this.ctx.botRooms.addMember(request.roomId, request.botId)
    return { room: this.roomView(room) }
  }

  /**
   * Remove one Bot from a room.
   * @param request - Room and Bot to remove.
   * @returns the room after the edit.
   */
  @Remote('roomsRemoveMember')
  async roomsRemoveMember(request: BotRoomMemberRequest): Promise<BotRoomValue> {
    const room = await this.ctx.botRooms.removeMember(request.roomId, request.botId)
    return { room: this.roomView(room) }
  }

  /**
   * Rename one room. Membership and the message log are untouched.
   * @param request - Room and its new display name.
   * @returns the room after the edit.
   */
  @Remote('roomsRename')
  async roomsRename(request: BotRoomRenameRequest): Promise<BotRoomValue> {
    const room = await this.ctx.botRooms.rename(request.roomId, request.name)
    return { room: this.roomView(room) }
  }

  /**
   * Read one room's message log in append order.
   * @param request - Room whose log is read, and an optional newest-N limit.
   * @returns the recorded messages.
   */
  @Remote('roomsMessages')
  roomsMessages(request: BotRoomMessagesRequest): Promise<BotRoomMessagesValue> {
    const room = this.ctx.botRooms.get(request.roomId)
    if (room === undefined) {
      return Promise.reject(new RemoteError(
        'bot/room-not-found',
        `Room "${String(request.roomId)}" not found`,
        { roomId: request.roomId },
      ))
    }
    return Promise.resolve({
      messages: this.ctx.botRooms.messages(request.roomId, request.limit).map(roomMessageView),
    })
  }

  /**
   * Post one user message into a room. The message is appended to the log
   * first, then delivered to the addressed members; their replies arrive
   * through the room stream as each Bot's turn closes.
   * @param request - Room and message body.
   * @returns the appended message.
   */
  @Remote('roomsPost')
  async roomsPost(request: BotRoomPostRequest): Promise<BotRoomPostValue> {
    const message = await this.ctx.botRooms.post(request.roomId, request.text, {
      kind: 'user',
      senderName: '用户',
    })
    return { message: roomMessageView(message) }
  }

  /**
   * Stream the complete room roster and every later increment.
   * @param signal - caller lifetime; aborting it ends the follower.
   * @returns the baseline frame followed by each increment.
   */
  @Remote({ mode: 'stream' })
  async *roomsFollow(signal: AbortSignal): AsyncIterable<RoomFollowFrame> {
    signal.throwIfAborted()
    const follower = new FrameFollower<RoomFollowFrame>()
    this.roomFollowers.add(follower)
    try {
      yield { type: 'baseline', value: { rooms: this.ctx.botRooms.list().map(room => this.roomView(room)) } }
      yield* follower.read(signal)
    } finally {
      this.roomFollowers.delete(follower)
      follower.close()
    }
  }

  /** Broadcast one committed room change to every room follower. */
  private publishRoomChange(change: RoomChange): void {
    const frame: RoomFollowIncrement = change.kind === 'message'
      ? { type: 'message', message: roomMessageView(change.message) }
      : change.kind === 'room-upsert'
        ? { type: 'room-upsert', room: this.roomView(change.room) }
        : { type: 'room-remove', roomId: change.roomId }
    for (const follower of this.roomFollowers) follower.push(frame)
  }

  /** Broadcast one Bot working-state transition to every room follower. */
  private publishActivity(activity: RoomActivity): void {
    const frame: RoomFollowIncrement = {
      type: 'activity',
      roomId: activity.roomId,
      botId: activity.botId,
      state: activity.state,
    }
    for (const follower of this.roomFollowers) follower.push(frame)
  }

  /** Project one Room for browser consumers, with members and message count. */
  private roomView(room: Room): RoomView {
    return roomProjection(room, this.ctx.botRooms.describeMembers(room), this.ctx.botRooms.messageCount(room.id))
  }

  /**
   * Stream the complete roster and its durable changes.
   * @param signal - caller lifetime; aborting it ends the follower.
   * @returns the baseline frame followed by each durable change.
   */
  @Remote({ mode: 'stream' })
  async *follow(signal: AbortSignal): AsyncIterable<BotFollowFrame> {
    signal.throwIfAborted()
    const follower = new FrameFollower<BotFollowFrame>()
    this.followers.add(follower)
    try {
      yield { type: 'baseline', value: { bots: this.ctx.bots.list().map(botView) } }
      yield* follower.read(signal)
    } finally {
      this.followers.delete(follower)
      follower.close()
    }
  }

  private changed(change: DomainChanged): void {
    if (change.domain !== 'bot' || change.table !== 'bots') return
    if (change.operation === 'deleted') {
      const frame: BotFollowFrame = { type: 'remove', botId: change.key as BotId }
      for (const follower of this.followers) follower.push(frame)
      return
    }
    // The `bots` table is typed `KvTable<BotId, BotRecord>`, so this snapshot is
    // the value its typed write path just committed and needs no re-validation
    // here; the record schema already validates on load.
    const frame: BotFollowFrame = {
      type: 'upsert',
      bot: recordView(change.key as BotId, change.value as BotRecord),
    }
    for (const follower of this.followers) follower.push(frame)
  }

}

/** Project one authoritative Bot entity into its Remote value. */
function botView(bot: Bot): BotView {
  return recordView(bot.id, bot)
}

/** Project one authoritative Room into its Remote value. */
function roomProjection(room: Room, members: readonly RoomMember[], messageCount: number): RoomView {
  return {
    roomId: room.id,
    name: room.name,
    memberIds: room.memberIds,
    members: members.map(member => ({ botId: member.botId, name: member.name })),
    messageCount,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
  }
}

/** Project one authoritative room message into its Remote value. */
function roomMessageView(message: RoomMessage): RoomMessageView {
  return {
    messageId: message.id,
    roomId: message.roomId,
    senderKind: message.senderKind,
    ...message.senderId === undefined ? {} : { senderId: message.senderId },
    senderName: message.senderName,
    text: message.text,
    mentions: message.mentions,
    createdAt: message.createdAt,
  }
}

/** Project one record shape into its Remote value. */
function recordView(botId: BotId, bot: {
  readonly name: string
  readonly description: string
  readonly preset: string
  readonly avatar?: string | undefined
  readonly permission?: string | undefined
  readonly workspaceId: BotView['workspaceId']
  readonly conversationId?: SessionId | undefined
  readonly createdAt: string
  readonly updatedAt: string
}): BotView {
  return {
    botId,
    name: bot.name,
    description: bot.description,
    preset: bot.preset,
    ...bot.avatar === undefined ? {} : { avatar: bot.avatar },
    ...bot.permission === undefined ? {} : { permission: bot.permission },
    workspaceId: bot.workspaceId,
    ...bot.conversationId === undefined ? {} : { conversationId: bot.conversationId },
    createdAt: bot.createdAt,
    updatedAt: bot.updatedAt,
  }
}

/** Single-generation queue ordered by the Host write chain. */
class FrameFollower<Frame> {
  private readonly frames = new Deque<Frame>()
  private waiting: (() => void) | undefined
  private closed = false

  push(frame: Frame): void {
    if (this.closed) return
    this.frames.pushBack(frame)
    this.waiting?.()
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.waiting?.()
  }

  async *read(signal: AbortSignal): AsyncIterable<Frame> {
    while (!this.closed && !signal.aborted) {
      const frame = this.frames.popFront()
      if (frame !== undefined) {
        yield frame
        continue
      }
      await this.wait(signal)
    }
  }

  private wait(signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const finish = (): void => {
        signal.removeEventListener('abort', finish)
        if (this.waiting === finish) this.waiting = undefined
        resolve()
      }
      this.waiting = finish
      signal.addEventListener('abort', finish, { once: true })
      if (signal.aborted || this.closed || this.frames.size > 0) finish()
    })
  }
}

export default BotController
