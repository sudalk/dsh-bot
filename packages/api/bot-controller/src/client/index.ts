/** Bot Client Remote state and commands. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-bot-controller/remote'
import {
  RemoteSnapshotStream,
  RemoteStreamCarrierError,
  type ClientRemote,
} from '@deepseek-ai/dsh-api-gateway/client'
import type { BotFollowFrame, BotFollowIncrement, RoomFollowFrame, RoomFollowIncrement } from '../types.ts'
import { ClientBotModel, ClientRoomModel } from './model.ts'
import { BotClientService, type IBots } from './service.ts'

export { ClientBotModel, ClientRoomModel } from './model.ts'
export { BotClientService, BotRemoteCommandError } from './service.ts'
export type { IBots } from './service.ts'
export type { BotRemote, BotSnapshot, RoomSnapshot } from './model.ts'
export type {
  BotConversationValue, BotId, BotRoomCreateRequest, BotRoomDeleteRequest, BotRoomGetRequest,
  BotRoomMemberRequest, BotRoomMessagesRequest, BotRoomPostRequest, BotRoomRenameRequest,
  BotRoomValue, BotRoomsValue, BotUpdateRequest, BotView, RoomFollowFrame, RoomId,
  RoomMemberView, RoomMessageView, RoomView,
} from '../types.ts'

type BotBaselineFrame = Extract<BotFollowFrame, { type: 'baseline' }>
type RoomBaselineFrame = Extract<RoomFollowFrame, { type: 'baseline' }>

/** Gateway-owned snapshot stream configured for Bot state. */
export type BotStateStream = RemoteSnapshotStream<
  BotBaselineFrame,
  BotFollowIncrement
>

/** Gateway-owned snapshot stream configured for room state. */
export type RoomStateStream = RemoteSnapshotStream<
  RoomBaselineFrame,
  RoomFollowIncrement
>

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** React-free Client Bot state and commands. */
    botsClient: IBots
  }
}

/** Required Client Remote services. */
export const inject = ['remote', 'remote.bot']

/** Install Bot client state, commands, and reconnecting follow control. */
export function apply(ctx: Context): void {
  const model = new ClientBotModel(ctx.remote.bot)
  const roomModel = new ClientRoomModel(ctx.remote.bot)
  new BotClientService(ctx, model, roomModel, ctx.remote.bot)
  const control = createBotStateStream(ctx.remote, {
    accept: model,
    carrierFailed: () => { model.handleStreamFailure(new RemoteStreamCarrierError('Bot stream carrier failed')) },
    failed: (error) => { model.handleStreamFailure(error) },
  })
  control.start()
  const roomControl = createRoomStateStream(ctx.remote, {
    accept: roomModel,
    carrierFailed: () => { roomModel.handleStreamFailure(new RemoteStreamCarrierError('Room stream carrier failed')) },
    failed: (error) => { roomModel.handleStreamFailure(error) },
  })
  roomControl.start()
  ctx.effect(() => async () => { await control.dispose() }, 'bot-controller.client.control')
  ctx.effect(() => async () => { await roomControl.dispose() }, 'bot-controller.client.room-control')
}

/** Domain sinks used by the Bot state stream. */
export interface BotStateStreamOptions {
  readonly accept: ClientBotModel
  readonly carrierFailed?: (error: RemoteStreamCarrierError) => void
  readonly failed: (error: unknown) => void
}

/** Domain sinks used by the room state stream. */
export interface RoomStateStreamOptions {
  readonly accept: ClientRoomModel
  readonly carrierFailed?: (error: RemoteStreamCarrierError) => void
  readonly failed: (error: unknown) => void
}

/**
 * Create the reconnecting Bot state stream.
 * @param remote - Client Remote carrying the generated `bot` namespace.
 * @param options - Domain sinks the decoded generations drive.
 * @returns the started-or-startable stream control.
 */
export function createBotStateStream(
  remote: ClientRemote,
  options: BotStateStreamOptions,
): BotStateStream {
  const stream = remote.$stream<BotFollowFrame>({
    name: 'Bot state stream',
    open: signal => remote.bot.follow(signal),
    ended: accepted => accepted
      ? new RemoteStreamCarrierError('Bot state stream ended without a terminal result')
      : new Error('Bot state stream ended before its opening snapshot'),
    ...(options.carrierFailed === undefined ? {} : { carrierFailed: options.carrierFailed }),
  })
  return new RemoteSnapshotStream<BotBaselineFrame, BotFollowIncrement>(stream, {
    name: 'Bot state stream',
    isSnapshot: (frame): frame is BotBaselineFrame => frame.type === 'baseline',
    replace: (frame) => { options.accept.replaceBaseline(frame.value.bots) },
    update: (frame) => { options.accept.acceptIncrement(frame) },
    failed: options.failed,
  })
}

/**
 * Create the reconnecting room state stream.
 * @param remote - Client Remote carrying the generated `bot` namespace.
 * @param options - Domain sinks the decoded generations drive.
 * @returns the started-or-startable stream control.
 */
export function createRoomStateStream(
  remote: ClientRemote,
  options: RoomStateStreamOptions,
): RoomStateStream {
  const stream = remote.$stream<RoomFollowFrame>({
    name: 'Room state stream',
    open: signal => remote.bot.roomsFollow(signal),
    ended: accepted => accepted
      ? new RemoteStreamCarrierError('Room state stream ended without a terminal result')
      : new Error('Room state stream ended before its opening snapshot'),
    ...(options.carrierFailed === undefined ? {} : { carrierFailed: options.carrierFailed }),
  })
  return new RemoteSnapshotStream<RoomBaselineFrame, RoomFollowIncrement>(stream, {
    name: 'Room state stream',
    isSnapshot: (frame): frame is RoomBaselineFrame => frame.type === 'baseline',
    replace: (frame) => { options.accept.replaceBaseline(frame.value.rooms) },
    update: (frame) => { options.accept.acceptIncrement(frame) },
    failed: options.failed,
  })
}
