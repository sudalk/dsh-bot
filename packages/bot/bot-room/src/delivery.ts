/**
 * Room delivery: routes one room message into the member Bots' own
 * conversations and folds their replies back into the room log. This is the
 * mechanism that makes a room read as one conversation between several Bots
 * while each Bot keeps its single durable conversation and identity.
 * @module @deepseek-ai/dsh-bot-room/src/delivery
 */

import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { BotId } from '@deepseek-ai/dsh-bot'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import { isRoomSkip } from './frame.ts'
import { parseRoomMentions } from './mentions.ts'
import { renderRoomDeliveryFrame } from './frame.ts'
import { ROOM_DELIVERY_MAX, ROOM_HANDOFF_MAX_DEPTH } from './limits.ts'
import type {
  RoomId, RoomMember, RoomMessage, RoomMessageId,
} from './types.ts'

/**
 * Source one delivered room message carries in the target Session. The room
 * message id is the de-duplication key: a delivery whose id already appears in
 * the Session log is a replay and is skipped.
 */
export interface RoomMessageSource {
  readonly kind: 'room-message'
  readonly roomId: RoomId
  readonly messageId: RoomMessageId
  /** Room display name at delivery time, for rendering the wake-up notice. */
  readonly roomName: string
  readonly senderId?: BotId
  readonly senderName: string
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'room-message': RoomMessageSource
  }
}

/** Working state of one Bot in one room, published for the room UI. */
export interface RoomActivity {
  readonly roomId: RoomId
  readonly botId: BotId
  readonly state: 'working' | 'idle'
}

/** Author of one message a caller asks the engine to post. */
export type RoomPostAuthor =
  | { readonly kind: 'user'; readonly senderName: string }
  | { readonly kind: 'bot'; readonly botId: BotId; readonly senderName: string }

/** One pending delivery of one room message into one Bot's conversation. */
interface DeliveryTask {
  readonly rootId: RoomMessageId
  readonly depth: number
  readonly roomId: RoomId
  readonly messageId: RoomMessageId
  readonly senderId: BotId | undefined
  readonly senderName: string
  readonly text: string
  readonly targetId: BotId
}

/** The delivery currently admitted to one Bot, awaiting its turn to close. */
interface ActiveDelivery {
  readonly task: DeliveryTask
  readonly sessionId: SessionId
  readonly botName: string
  turn: number | undefined
  reply: string | undefined
}

/** Per-root diffusion budget: deliveries left and whether the cap was announced. */
interface RootBudget {
  remaining: number
  announced: boolean
}

const key = (id: { toString(): string }): string => String(id)

/**
 * Room message router. Posting a message appends it to the room log and
 * fans it out to the addressed Bots; each target receives one framed user
 * message in its own conversation, and its closing turn is captured back
 * into the room. Diffusion is bounded per root message by a delivery budget
 * and a handoff depth, so Bots that mention each other cannot loop forever.
 *
 * Delivery is serialized per Bot: one Bot has at most one admitted delivery
 * awaiting a closing turn, and the rest wait in that Bot's queue. Reply
 * capture reads the first turn the target opens after admission, so a
 * message queued behind unrelated work never mistakes that work for its
 * answer.
 */
export class BotRoomDelivery {
  private readonly queues = new Map<string, DeliveryTask[]>()
  private readonly activeByBot = new Map<string, ActiveDelivery>()
  private readonly activeBySession = new Map<string, string>()
  private readonly outstanding = new Map<string, number>()
  private readonly budgets = new Map<string, RootBudget>()
  private readonly activityListeners = new Set<(activity: RoomActivity) => void>()
  private disposed = false

  /** @param ctx - Host context carrying Bot, Room, Session, and Agent services. */
  constructor(private readonly ctx: Context) {}

  /** Stop accepting work and drop every queued or in-flight delivery. */
  dispose(): void {
    this.disposed = true
    this.queues.clear()
    this.activeByBot.clear()
    this.activeBySession.clear()
    this.outstanding.clear()
    this.budgets.clear()
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
    const room = this.ctx.botRooms.get(roomId)
    if (room === undefined) throw new Error(`room "${key(roomId)}" not found`)
    const members = this.ctx.botRooms.describeMembers(room)
    const mentions = parseRoomMentions(text, members)
    const message = await this.ctx.botRooms.appendMessage({
      roomId,
      senderKind: author.kind,
      ...author.kind === 'bot' ? { senderId: author.botId } : {},
      senderName: author.senderName,
      text,
      mentions: mentions.botIds,
    })
    this.budgets.set(key(message.id), { remaining: ROOM_DELIVERY_MAX, announced: false })
    for (const member of this.resolveTargets(message, members, author)) {
      this.enqueue(message, message.id, 0, member.botId, author.senderName, text)
    }
    return message
  }

  /**
   * Observe one Session event for reply capture.
   * @param session - Session receiving the event.
   * @param event - Newly appended Session event.
   */
  observeSessionEvent(session: Session, event: SessionEvent): void {
    if (this.disposed) return
    const botKey = this.activeBySession.get(key(session.id))
    if (botKey === undefined) return
    const active = this.activeByBot.get(botKey)
    if (active === undefined) return
    switch (event.type) {
      case 'turn/start':
        if (active.turn === undefined) active.turn = event.data.turn
        return
      case 'assistant/message':
        if (active.turn === event.data.turn) active.reply = assistantText(event.data.message.content)
        return
      case 'turn/end': {
        if (active.turn === undefined || active.turn !== event.data.turn) return
        this.activeBySession.delete(key(session.id))
        this.activeByBot.delete(botKey)
        void this.settle(active).then(
          () => { this.finish(active.task) },
          (error: unknown) => {
            this.ctx.logger.warn(`room reply handling failed: ${String(error)}`)
            this.finish(active.task)
          },
        )
        return
      }
      default:
        return
    }
  }

  /**
   * Subscribe to per-Bot working state for the room UI.
   * @param listener - Called on each state transition.
   * @returns the unsubscribe function.
   */
  subscribeActivity(listener: (activity: RoomActivity) => void): () => void {
    this.activityListeners.add(listener)
    return () => { this.activityListeners.delete(listener) }
  }

  /**
   * Fold back one Bot's captured reply: a skip stays out of the log, a reply
   * is appended under the Bot's identity, and its mentions become handoffs.
   */
  private async settle(active: ActiveDelivery): Promise<void> {
    const { task, botName } = active
    const reply = active.reply
    if (reply === undefined || reply.trim() === '') {
      this.ctx.logger.warn(`room "${key(task.roomId)}": Bot "${key(task.targetId)}" produced no reply text`)
      return
    }
    if (isRoomSkip(reply)) return
    const room = this.ctx.botRooms.get(task.roomId)
    if (room === undefined) return
    const members = this.ctx.botRooms.describeMembers(room)
    if (!members.some(member => key(member.botId) === key(task.targetId))) return
    const mentions = parseRoomMentions(reply, members)
    const message = await this.ctx.botRooms.appendMessage({
      roomId: task.roomId,
      senderKind: 'bot',
      senderId: task.targetId,
      senderName: botName,
      text: reply,
      mentions: mentions.botIds,
    })
    // A Bot's reply hands the next stage to the members it names, never back
    // to itself; a plain reply addresses no one and wakes no one.
    const handoffs = members.filter(member =>
      mentions.botIds.some(id => key(id) === key(member.botId))
      && key(member.botId) !== key(task.targetId))
    if (handoffs.length === 0) return
    const depth = task.depth + 1
    if (depth > ROOM_HANDOFF_MAX_DEPTH) {
      this.announceCapOnce(task.rootId, task.roomId,
        `交接层数已达上限（${ROOM_HANDOFF_MAX_DEPTH} 层），不再继续唤醒`)
      return
    }
    for (const member of handoffs) this.enqueue(message, task.rootId, depth, member.botId, botName, reply)
  }

  /** Resolve the audience of one message: explicit mentions, or every member. */
  private resolveTargets(
    message: RoomMessage,
    members: readonly RoomMember[],
    author: RoomPostAuthor,
  ): readonly RoomMember[] {
    const audience = message.mentions.length === 0
      ? members
      : members.filter(member => message.mentions.some(id => key(id) === key(member.botId)))
    if (author.kind === 'bot') {
      return audience.filter(member => key(member.botId) !== key(author.botId))
    }
    return audience
  }

  /** Queue one delivery and kick its target's dispatcher. */
  private enqueue(
    source: RoomMessage,
    rootId: RoomMessageId,
    depth: number,
    targetId: BotId,
    senderName: string,
    text: string,
  ): void {
    if (this.disposed) return
    const budget = this.budgets.get(key(rootId))
    if (budget !== undefined) {
      if (budget.remaining <= 0) {
        this.announceCapOnce(rootId, source.roomId,
          `本回合的唤醒次数已达上限（${ROOM_DELIVERY_MAX} 次），不再继续唤醒`)
        return
      }
      budget.remaining -= 1
    }
    const task: DeliveryTask = {
      rootId,
      depth,
      roomId: source.roomId,
      messageId: source.id,
      senderId: source.senderId,
      senderName,
      text,
      targetId,
    }
    const queueKey = key(targetId)
    const queue = this.queues.get(queueKey) ?? []
    queue.push(task)
    this.queues.set(queueKey, queue)
    this.retain(source.roomId, targetId, 1)
    void this.dispatch(queueKey)
  }

  /** Deliver queued tasks for one Bot, one at a time. */
  private async dispatch(queueKey: string): Promise<void> {
    if (this.disposed || this.activeByBot.has(queueKey)) return
    const queue = this.queues.get(queueKey)
    const task = queue?.shift()
    if (task === undefined) {
      this.queues.delete(queueKey)
      return
    }
    const bot = this.ctx.bots.get(task.targetId)
    if (bot === undefined) {
      await this.systemNote(task.roomId, '一个成员 Bot 已不在名册，跳过投递')
      this.release(task)
      return
    }
    try {
      const room = this.ctx.botRooms.get(task.roomId)
      const members = room === undefined ? [] : this.ctx.botRooms.describeMembers(room)
      if (room === undefined || !members.some(member => key(member.botId) === key(task.targetId))) {
        this.release(task)
        return
      }
      const sessionId = await bot.ensureConversation()
      const resolved = await this.ctx.sessionController.resolveAgent(sessionId)
      if ('error' in resolved) {
        await this.systemNote(task.roomId, `无法唤醒「${bot.name}」：${resolved.error.message}`)
        this.release(task)
        return
      }
      const agent = resolved.agent
      if (this.recorded(agent.session, task.messageId)) {
        this.release(task)
        return
      }
      const frame = renderRoomDeliveryFrame({
        roomName: room.name,
        members: members.map(member => ({ name: member.name })),
        recent: this.ctx.botRooms.messages(task.roomId, 20)
          .filter(entry => key(entry.id) !== key(task.messageId))
          .map(entry => ({ senderName: entry.senderName, text: entry.text })),
        senderName: task.senderName,
        text: task.text,
      })
      const source: RoomMessageSource = {
        kind: 'room-message',
        roomId: task.roomId,
        messageId: task.messageId,
        roomName: room.name,
        ...task.senderId === undefined ? {} : { senderId: task.senderId },
        senderName: task.senderName,
      }
      const active: ActiveDelivery = { task, sessionId, botName: bot.name, turn: undefined, reply: undefined }
      this.activeByBot.set(queueKey, active)
      this.activeBySession.set(key(sessionId), queueKey)
      try {
        agent.followup(createUserMessage({ content: [{ type: 'text', text: frame }], source }))
      } catch (error) {
        this.activeByBot.delete(queueKey)
        this.activeBySession.delete(key(sessionId))
        throw error
      }
    } catch (error) {
      await this.systemNote(task.roomId, `「${bot.name}」投递失败：${String(error)}`)
      this.release(task)
    }
  }

  /** Drop one task's outstanding count and admit the next queued delivery. */
  private release(task: DeliveryTask): void {
    this.retain(task.roomId, task.targetId, -1)
    void this.dispatch(key(task.targetId))
  }

  /** Complete one delivery after its reply was handled. */
  private finish(task: DeliveryTask): void {
    this.release(task)
  }

  /** Adjust one Bot's outstanding-delivery count, publishing each transition. */
  private retain(roomId: RoomId, botId: BotId, delta: number): void {
    const botKey = key(botId)
    const before = this.outstanding.get(botKey) ?? 0
    const after = before + delta
    if (after <= 0) this.outstanding.delete(botKey)
    else this.outstanding.set(botKey, after)
    if (before === 0 && after > 0) this.publishActivity(roomId, botId, 'working')
    if (before > 0 && after <= 0) this.publishActivity(roomId, botId, 'idle')
  }

  /** Publish one activity transition to every listener. */
  private publishActivity(roomId: RoomId, botId: BotId, state: RoomActivity['state']): void {
    for (const listener of [...this.activityListeners]) {
      try {
        listener({ roomId, botId, state })
      } catch (error) {
        this.ctx.logger.warn(`room activity listener failed: ${String(error)}`)
      }
    }
  }

  /** Append one system line to a room log. Failures never break delivery. */
  private async systemNote(roomId: RoomId, text: string): Promise<void> {
    try {
      await this.ctx.botRooms.appendMessage({
        roomId,
        senderKind: 'system',
        senderName: '系统',
        text,
        mentions: [],
      })
    } catch (error) {
      this.ctx.logger.warn(`room system note failed: ${String(error)}`)
    }
  }

  /** Announce a diffusion cap once per root message. */
  private announceCapOnce(rootId: RoomMessageId, roomId: RoomId, text: string): void {
    const budget = this.budgets.get(key(rootId))
    if (budget === undefined || budget.announced) return
    budget.announced = true
    void this.systemNote(roomId, text)
  }

  /** Whether a Session log already carries one delivered room message. */
  private recorded(session: Session, messageId: RoomMessageId): boolean {
    // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
    const events = session.snapshotEvents(session.inheritedEventCount)
    return events.some(event => event.type === 'user/message'
      && event.data.source.kind === 'room-message'
      && key(event.data.source.messageId) === key(messageId))
  }
}

/** Concatenate the text blocks of one assistant message. */
function assistantText(content: readonly ContentBlock[]): string {
  return content
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('')
}
