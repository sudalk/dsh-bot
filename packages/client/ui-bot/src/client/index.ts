/** Bot roster panel and per-Bot chat registration. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { BotConversationValue, BotId, BotSnapshot, BotView } from '@deepseek-ai/dsh-api-bot-controller/client'
import type {} from '@deepseek-ai/dsh-api-bot-controller/client'
import type { IBots } from '@deepseek-ai/dsh-api-bot-controller/client'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
// Type-only: pulls the ctx.remote merge and the permission namespace a Bot's
// pin is written through.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { PresetOption } from '@deepseek-ai/dsh-permission-presets/client'
import type { ResourceProvider } from '@deepseek-ai/dsh-client-resources/client'
import type {} from '@deepseek-ai/dsh-client-resources/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls the Workspace plugin's session-visibility face, which the
// roster fills so its chats stay out of the Workspace browser.
import type { ISessionVisibility } from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { RemoteError, remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import { BotConversationPage } from './BotConversationPage.tsx'
import { BotManagerIcon } from './BotManagerIcon.tsx'
import { BotManagerPage, type BotManagerInjected } from './BotManagerPage.tsx'
import { parseBotChatAddress } from './botChatResource.ts'
import { en, NS, zh, type BotRosterKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'bot.roster': BotRosterKey
  }

  interface SlotMap {
    /** Session-scoped Conversation occurrence hosted by the Bots panel. */
    'bot.chat': {
      kind: 'single'
      scope: 'session'
      owner: {
        /** Bot whose continuing conversation this occurrence renders. */
        readonly bot: BotView
      }
    }
  }
}

const PANEL_ID = 'bots' as MainPanelId

/** Shared empty hidden set: a roster whose Bots have not chatted yet hides nothing. */
const NO_BOT_CHATS: ReadonlySet<SessionId> = new Set()

export const inject = [
  'slots', 'locale', 'botsClient', 'workspaces', 'sessions', 'resources',
  'remote', 'remote.permissionPresets',
]

/** Resolve the given address to a signal that settles when it aborts. */
function waitForAbort(signal: AbortSignal): Promise<void> {
  if (isAbortRequested(signal)) return Promise.resolve()
  return new Promise((resolve) => {
    signal.addEventListener('abort', () => { resolve() }, { once: true })
  })
}

/** Poll the current abort state; a property read cannot stay narrowed to the pre-await value. */
function isAbortRequested(signal: AbortSignal): boolean {
  return signal.aborted
}

/** A rejected promise must carry an Error; the transport's own throw passes through untouched. */
function asRejection(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

/** Deadline for one Bot chat open; a silent Host becomes a retryable failure instead of a hung panel. */
const OPEN_TIMEOUT_MS = 15_000

/**
 * Await the Host's Bot conversation, failing the wait when the call never
 * settles, so a broken transport cannot strand the panel on the opening view.
 * @param bots - Client Bot commands.
 * @param botId - Bot whose chat is being opened.
 * @returns the Bot's conversation identity.
 */
function ensureConversationWithin(bots: IBots, botId: BotId): Promise<BotConversationValue> {
  return new Promise((resolve, reject) => {
    const deadline = setTimeout(() => {
      reject(new RemoteError('botchat/open-failed', 'ui-bot: opening this Bot conversation timed out', {}))
    }, OPEN_TIMEOUT_MS)
    bots.ensureConversation({ botId }).then(
      (value) => { clearTimeout(deadline); resolve(value) },
      (error: unknown) => { clearTimeout(deadline); reject(asRejection(error)) },
    )
  })
}

/**
 * Serve `dsh-resource://botchat/bot/<id>`: resolve the Bot's continuing
 * conversation on the Host — created once and resumed afterwards — and retain
 * it for as long as the chat panel holds the resource.
 * @param ctx - Client context carrying the transcript presentation override.
 * @param bots - Client Bot commands.
 * @param sessions - Client Session references.
 * @returns the Bot chat resource provider.
 */
function botChatResourceProvider(
  ctx: ClientContext,
  bots: IBots,
  sessions: ISessions,
): ResourceProvider<'botchat'> {
  return {
    protocol: 'botchat',
    async *open(resourceAddress, { signal }) {
      const botId = parseBotChatAddress(resourceAddress)
      if (botId === undefined) {
        yield {
          ok: false,
          error: new RemoteError('botchat/invalid-address', `ui-bot: invalid chat resource address "${resourceAddress}"`, {}),
        }
        return
      }
      if (isAbortRequested(signal)) return
      try {
        const { sessionId } = await ensureConversationWithin(bots, botId)
        if (isAbortRequested(signal)) return
        // A Bot conversation is a chat, not a work transcript: the Chat target
        // quiets this Session's work-console chrome — reasoning rows, the
        // work-report Turn label, the per-Turn usage pill, and the session
        // statistics — without touching the user's settings for other Sessions.
        ctx.get('chatTranscript')?.set(sessionId, {
          hideReasoning: true,
          hideTurnProcess: true,
          hideTurnUsage: true,
          hideSessionStats: true,
        })
        const reference = sessions.retain(sessionId, { source: 'botChat', signal })
        try {
          yield { ok: true, value: { botId, reference } }
          await waitForAbort(signal)
        } finally {
          reference.release()
        }
      } catch (error) {
        if (isAbortRequested(signal)) return
        yield {
          ok: false,
          error: remoteErrorOf(error)
            ?? new RemoteError('botchat/open-failed', error instanceof Error ? error.message : String(error), {}),
        }
      }
    },
  }
}

/**
 * Register the Bots main panel, the Bot chat it hosts, and the Sidebar entry.
 * @param ctx - Client services carrying Bot, Session, and Workspace state.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-bot: dictionaries')
  const t = ctx.locale.bind(NS)
  const sessions = ctx.get('sessions')
  if (sessions === undefined) throw new Error('ui-bot: sessions service unavailable')

  // A Bot's continuing chat belongs to this roster, not the Workspace
  // browser: publish the roster's conversation Sessions through the
  // session-visibility face so every browser list leaves them out. Room
  // messages are not Sessions at all, so a room's transcript never reaches
  // the Workspace browser. The set is memoized per roster snapshot, so the
  // browser sees a new identity only while the conversations can be moving.
  let chatsFor: BotSnapshot | undefined
  let chats: ReadonlySet<SessionId> = NO_BOT_CHATS
  const hidden: ISessionVisibility['hidden'] = {
    getSnapshot: () => {
      const roster = ctx.botsClient.list.getSnapshot()
      if (chatsFor !== roster) {
        const next = new Set<SessionId>()
        for (const bot of roster.bots) {
          if (bot.conversationId !== undefined) next.add(bot.conversationId)
        }
        chatsFor = roster
        chats = next
      }
      return chats
    },
    subscribe: listener => ctx.botsClient.list.subscribe(listener),
  }
  const disposeVisibility = ctx.reflect.provide('sessionVisibility', { hidden })
  ctx.effect(() => () => { void disposeVisibility() }, 'ui-bot: session visibility')

  ctx.effect(
    () => ctx.resources.register(botChatResourceProvider(ctx, ctx.botsClient, sessions)),
    'ui-bot: chat resources',
  )

  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_ID,
    locale: NS,
    children: {
      'bot.chat': { kind: 'single', scope: 'session' },
    },
    inject: (): BotManagerInjected => ({
      hooks: { list: ctx.botsClient.list, rooms: ctx.botsClient.rooms },
      workspaces: ctx.workspaces.list.getSnapshot().items,
      create: input => ctx.botsClient.create(input),
      remove: botId => ctx.botsClient.delete({ botId }),
      update: input => ctx.botsClient.update(input),
      // Only configured presets may be pinned: `options` also carries the live
      // current-session Auto preset, which is not a durable Bot setting.
      loadPermissionOptions: async (): Promise<readonly PresetOption[]> => {
        const result = await ctx.remote.permissionPresets.catalog()
        if (!result.ok) {
          throw new Error(`ui-bot: permission catalog failed: ${result.error.code}: ${result.error.message}`)
        }
        return result.value.defaultOptions
      },
      createRoom: input => ctx.botsClient.createRoom(input),
      deleteRoom: roomId => ctx.botsClient.deleteRoom({ roomId }),
      renameRoom: input => ctx.botsClient.renameRoom(input),
      addRoomMember: (roomId, botId) => ctx.botsClient.addRoomMember({ roomId, botId }),
      removeRoomMember: (roomId, botId) => ctx.botsClient.removeRoomMember({ roomId, botId }),
      loadRoomMessages: roomId => ctx.botsClient.roomMessages({ roomId }),
      postRoomMessage: (roomId, text) => ctx.botsClient.postRoomMessage({ roomId, text }),
      messagesOf: roomId => ctx.botsClient.rooms.getMessages(roomId),
      workingOf: roomId => ctx.botsClient.rooms.getWorking(roomId),
    }),
  }, BotManagerPage))

  ctx.slots.inject('bot.chat', () => ctx.slots.register({
    name: 'bot.chat',
    locale: NS,
  }, BotConversationPage))

  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 11,
    locale: NS,
    label: () => t('panel'),
  }, BotManagerIcon))
}
