/** React-free Client Bot service and command facade. */

import { Service, type Context } from '@deepseek-ai/cordis'
import type { RemoteFailure } from '@deepseek-ai/dsh-typert-protocol'
import type { BotView, RoomMessageView, RoomView } from '../types.ts'
import type {
  BotConversationRequest, BotConversationValue,
  BotCreateRequest, BotDeleteRequest, BotInsertBeforeRequest, BotRoomCreateRequest,
  BotRoomDeleteRequest, BotRoomGetRequest, BotRoomMemberRequest, BotRoomMessagesRequest,
  BotRoomPostRequest, BotRoomRenameRequest, BotUpdateRequest,
} from '../types.ts'
import type { BotRemote, ClientBotModel, ClientRoomModel } from './model.ts'

/** Public client service interface. */
export interface IBots {
  readonly list: ClientBotModel
  readonly rooms: ClientRoomModel
  create(request: BotCreateRequest): Promise<BotView>
  update(request: BotUpdateRequest): Promise<BotView>
  delete(request: BotDeleteRequest): Promise<void>
  insertBefore(request: BotInsertBeforeRequest): Promise<void>
  ensureConversation(request: BotConversationRequest): Promise<BotConversationValue>
  listRooms(): Promise<readonly RoomView[]>
  createRoom(request: BotRoomCreateRequest): Promise<RoomView>
  getRoom(request: BotRoomGetRequest): Promise<RoomView>
  deleteRoom(request: BotRoomDeleteRequest): Promise<void>
  renameRoom(request: BotRoomRenameRequest): Promise<RoomView>
  addRoomMember(request: BotRoomMemberRequest): Promise<RoomView>
  removeRoomMember(request: BotRoomMemberRequest): Promise<RoomView>
  roomMessages(request: BotRoomMessagesRequest): Promise<readonly RoomMessageView[]>
  postRoomMessage(request: BotRoomPostRequest): Promise<RoomMessageView>
}

/** Client Bot command facade. */
export class BotClientService extends Service implements IBots {
  readonly list: ClientBotModel
  readonly rooms: ClientRoomModel

  constructor(
    ctx: Context,
    model: ClientBotModel,
    roomModel: ClientRoomModel,
    private readonly remote: BotRemote,
  ) {
    super(ctx, 'botsClient')
    this.list = model
    this.rooms = roomModel
  }

  async create(request: BotCreateRequest): Promise<BotView> {
    const result = await this.remote.create(request)
    if (!result.ok) throw new BotRemoteCommandError('create', result.error)
    return result.value.bot
  }

  async update(request: BotUpdateRequest): Promise<BotView> {
    const result = await this.remote.update(request)
    if (!result.ok) throw new BotRemoteCommandError('update', result.error)
    return result.value.bot
  }

  async delete(request: BotDeleteRequest): Promise<void> {
    const result = await this.remote.delete(request)
    if (!result.ok) throw new BotRemoteCommandError('delete', result.error)
  }

  async insertBefore(request: BotInsertBeforeRequest): Promise<void> {
    const result = await this.remote.insertBefore(request)
    if (!result.ok) throw new BotRemoteCommandError('move', result.error)
  }

  /**
   * Resolve the Bot's continuing conversation, creating it on the first ask.
   * The adoption itself reaches the roster through the durable follow stream,
   * so this call only carries the answer back to the caller.
   * @param request - Bot whose chat is being opened.
   * @returns the Bot's conversation identity.
   */
  async ensureConversation(request: BotConversationRequest): Promise<BotConversationValue> {
    const result = await this.remote.ensureConversation(request)
    if (!result.ok) throw new BotRemoteCommandError('open chat', result.error)
    return result.value
  }

  async listRooms(): Promise<readonly RoomView[]> {
    const result = await this.remote.roomsList()
    if (!result.ok) throw new BotRemoteCommandError('list rooms', result.error)
    return result.value.rooms
  }

  async createRoom(request: BotRoomCreateRequest): Promise<RoomView> {
    const result = await this.remote.roomsCreate(request)
    if (!result.ok) throw new BotRemoteCommandError('create room', result.error)
    return result.value.room
  }

  async getRoom(request: BotRoomGetRequest): Promise<RoomView> {
    const result = await this.remote.roomsGet(request)
    if (!result.ok) throw new BotRemoteCommandError('read room', result.error)
    return result.value.room
  }

  async deleteRoom(request: BotRoomDeleteRequest): Promise<void> {
    const result = await this.remote.roomsDelete(request)
    if (!result.ok) throw new BotRemoteCommandError('delete room', result.error)
  }

  async renameRoom(request: BotRoomRenameRequest): Promise<RoomView> {
    const result = await this.remote.roomsRename(request)
    if (!result.ok) throw new BotRemoteCommandError('rename room', result.error)
    return result.value.room
  }

  async addRoomMember(request: BotRoomMemberRequest): Promise<RoomView> {
    const result = await this.remote.roomsAddMember(request)
    if (!result.ok) throw new BotRemoteCommandError('add member', result.error)
    return result.value.room
  }

  async removeRoomMember(request: BotRoomMemberRequest): Promise<RoomView> {
    const result = await this.remote.roomsRemoveMember(request)
    if (!result.ok) throw new BotRemoteCommandError('remove member', result.error)
    return result.value.room
  }

  async roomMessages(request: BotRoomMessagesRequest): Promise<readonly RoomMessageView[]> {
    const result = await this.remote.roomsMessages(request)
    if (!result.ok) throw new BotRemoteCommandError('read messages', result.error)
    return result.value.messages
  }

  async postRoomMessage(request: BotRoomPostRequest): Promise<RoomMessageView> {
    const result = await this.remote.roomsPost(request)
    if (!result.ok) throw new BotRemoteCommandError('post message', result.error)
    return result.value.message
  }
}

/** Folded client command failure. */
export class BotRemoteCommandError extends Error {
  constructor(operation: string, readonly failure: RemoteFailure) {
    super(`bot ${operation} failed: ${failure.code}: ${failure.message}`)
    this.name = 'BotRemoteCommandError'
  }
}
