/** Browser-safe request, result, and state vocabulary for the Bot Remote namespace. */

import type { BotId } from '@deepseek-ai/dsh-bot/types'
import type { RoomId, RoomMessageId, RoomSenderKind } from '@deepseek-ai/dsh-bot-room/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'

export type { BotId } from '@deepseek-ai/dsh-bot/types'
export type { RoomId, RoomMessageId, RoomSenderKind } from '@deepseek-ai/dsh-bot-room/types'
export type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'

/** One Bot projected for browser consumers. */
export interface BotView {
  readonly botId: BotId
  /** Display name. */
  readonly name: string
  /** Durable role description. */
  readonly description: string
  /** Agent preset used by Bot conversations. */
  readonly preset: string
  /** Avatar image as a data URL; absent while the Bot has none. */
  readonly avatar?: string
  /** Permission preset this Bot's conversations run under; absent follows the deployment default. */
  readonly permission?: string
  /** Workspace whose directory is the Bot home. */
  readonly workspaceId: WorkspaceId
  /** The Bot's continuing conversation; absent until the first chat opens it. */
  readonly conversationId?: SessionId
  /** ISO-8601 creation instant. */
  readonly createdAt: string
  /** ISO-8601 last-mutation instant. */
  readonly updatedAt: string
}

/** Complete Bot profile for creation. */
export interface BotCreateRequest {
  readonly name: string
  readonly description: string
  readonly preset: string
  /** Permission preset this Bot's conversations run under; omitted follows the deployment default. */
  readonly permission?: string
  readonly workspaceId: WorkspaceId
}

/** Created Bot result. */
export interface BotCreateValue {
  readonly bot: BotView
}

/** Bot identity and mutable profile replacement. */
export interface BotUpdateRequest {
  readonly botId: BotId
  readonly name?: string
  readonly description?: string
  readonly preset?: string
  readonly workspaceId?: WorkspaceId
  /** Avatar data URL to replace in place; the empty string clears it. */
  readonly avatar?: string
  /** Permission preset to pin; the empty string returns to the deployment default. */
  readonly permission?: string
}

/** Bot mutation result. */
export interface BotValue {
  readonly bot: BotView
}

/** Bot deletion request. */
export interface BotDeleteRequest {
  readonly botId: BotId
}

/** Bot deletion result. */
export interface BotDeleteValue {
  readonly deleted: true
}

/** Bot roster order request. */
export interface BotInsertBeforeRequest {
  readonly botId: BotId
  readonly beforeBotId?: BotId
}

/** Bot roster order result. */
export interface BotOrderValue {
  readonly botIds: readonly BotId[]
}

/** One Bot's continuing conversation request. */
export interface BotConversationRequest {
  readonly botId: BotId
}

/** One Bot's continuing conversation, created on the first request. */
export interface BotConversationValue {
  /** Authoritative Bot after the conversation was established. */
  readonly bot: BotView
  /** Session the Bot's chat resumes every time it is opened. */
  readonly sessionId: SessionId
}

/** One room member resolved against the Bot roster. */
export interface RoomMemberView {
  readonly botId: BotId
  /** The Bot's display name, or its id when the record is gone. */
  readonly name: string
}

/** One Room (durable group chat) projected for browser consumers. */
export interface RoomView {
  readonly roomId: RoomId
  /** Display name of the group chat. */
  readonly name: string
  /** Bots addressed in this room, in join order. */
  readonly memberIds: readonly BotId[]
  /** Members resolved for display. */
  readonly members: readonly RoomMemberView[]
  /** Number of messages currently recorded in the room log. */
  readonly messageCount: number
  /** ISO-8601 creation instant. */
  readonly createdAt: string
  /** ISO-8601 last-mutation instant. */
  readonly updatedAt: string
}

/** One room message projected for browser consumers. */
export interface RoomMessageView {
  readonly messageId: RoomMessageId
  readonly roomId: RoomId
  /** Author class: the human, one Bot, or the room itself. */
  readonly senderKind: RoomSenderKind
  /** Authoring Bot, present exactly when `senderKind` is `bot`. */
  readonly senderId?: BotId
  /** Display name recorded with the message. */
  readonly senderName: string
  /** Message body, verbatim. */
  readonly text: string
  /** Bots this message addressed. */
  readonly mentions: readonly BotId[]
  /** ISO-8601 instant the message was appended. */
  readonly createdAt: string
}

/** Complete room roster result. */
export interface BotRoomsValue {
  readonly rooms: readonly RoomView[]
}

/** Room creation request over a member roster. */
export interface BotRoomCreateRequest {
  readonly name: string
  readonly memberIds: readonly BotId[]
}

/** One room result. */
export interface BotRoomValue {
  readonly room: RoomView
}

/** Room lookup request. */
export interface BotRoomGetRequest {
  readonly roomId: RoomId
}

/** Room deletion request. */
export interface BotRoomDeleteRequest {
  readonly roomId: RoomId
}

/** Room rename request. */
export interface BotRoomRenameRequest {
  readonly roomId: RoomId
  /** New display name for the group chat. */
  readonly name: string
}

/** Room deletion result. */
export interface BotRoomDeleteValue {
  readonly deleted: true
}

/** Room message log request. */
export interface BotRoomMessagesRequest {
  readonly roomId: RoomId
  /** Keep only the newest `limit` messages; omitted reads the whole log. */
  readonly limit?: number
}

/** Room message log result. */
export interface BotRoomMessagesValue {
  readonly messages: readonly RoomMessageView[]
}

/** Room message post request. */
export interface BotRoomPostRequest {
  readonly roomId: RoomId
  /** Message body, parsed for `@member` mentions before delivery. */
  readonly text: string
}

/** Room message post result. */
export interface BotRoomPostValue {
  readonly message: RoomMessageView
}

/** Room membership edit request. */
export interface BotRoomMemberRequest {
  readonly roomId: RoomId
  readonly botId: BotId
}

/** Complete Bot roster baseline. */
export interface BotBaseline {
  readonly bots: readonly BotView[]
}

/** One roster increment after a baseline. */
export type BotFollowIncrement =
  | { readonly type: 'upsert'; readonly bot: BotView }
  | { readonly type: 'remove'; readonly botId: BotId }
  | { readonly type: 'order'; readonly botIds: readonly BotId[] }

/** Bot state stream; every generation starts with one baseline. */
export type BotFollowFrame =
  | { readonly type: 'baseline'; readonly value: BotBaseline }
  | BotFollowIncrement

/** Complete room roster baseline. */
export interface RoomBaseline {
  readonly rooms: readonly RoomView[]
}

/** One room increment after a baseline. */
export type RoomFollowIncrement =
  | { readonly type: 'room-upsert'; readonly room: RoomView }
  | { readonly type: 'room-remove'; readonly roomId: RoomId }
  | { readonly type: 'message'; readonly message: RoomMessageView }
  | {
    readonly type: 'activity'
    readonly roomId: RoomId
    readonly botId: BotId
    readonly state: 'working' | 'idle'
  }

/** Room state stream; every generation starts with one baseline. */
export type RoomFollowFrame =
  | { readonly type: 'baseline'; readonly value: RoomBaseline }
  | RoomFollowIncrement
