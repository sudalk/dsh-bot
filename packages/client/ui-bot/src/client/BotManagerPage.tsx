/** Bots panel: the conversation rail beside the selected conversation or roster. */
import { useEffect, useState } from 'react'
import clsx from 'clsx'
import {
  Button, IconAgentPresetOutlineRegular, IconNewChatOutlineRegular,
  IconPlusOutlineRegular, IconUsersOutlineRegular, Input, StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  HostObservable, InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import type {
  BotId, BotRoomRenameRequest, BotSnapshot, BotUpdateRequest, BotView, RoomId, RoomMessageView,
  RoomSnapshot, RoomView,
} from '@deepseek-ai/dsh-api-bot-controller/client'
import type { WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { PresetOption } from '@deepseek-ai/dsh-permission-presets/client'
import { botChatAddress } from './botChatResource.ts'
import { InfoDrawer } from './InfoDrawer.tsx'
import { PanelInfoContext } from './panel-info.ts'
import { permissionLabel } from './permission-display.ts'
import { RoomPane } from './RoomPane.tsx'
import css from './BotManagerPage.module.css'

/** Props for the Bots panel. */
export type BotManagerPageProps =
  PropsRuntime<'main'>
  & InjectFace<BotManagerInjected>
  & PropsLocale<'bot.roster'>
  & PropsRenderSlots<'bot.chat'>

export interface BotManagerInjected {
  /** Bot roster and room state. */
  readonly hooks: {
    readonly list: HostObservable<BotSnapshot>
    readonly rooms: HostObservable<RoomSnapshot>
  }
  /** Workspaces a new Bot may use. */
  readonly workspaces: readonly WorkspaceView[]
  /** Create a Bot.
   * @param input - complete Bot profile.
   * @returns the authoritative Bot.
   */
  create(input: {
    readonly name: string
    readonly description: string
    readonly preset: string
    /** Permission preset to pin from creation; omitted follows the deployment default. */
    readonly permission?: string
    /** Home workspace; omitted creates a pure chat Bot without one. */
    readonly workspaceId?: WorkspaceId
  }): Promise<BotView>
  /** Load the permission presets a Bot may pin; the empty list hides the control.
   * @returns the advertised presets, in catalog order.
   */
  loadPermissionOptions(): Promise<readonly PresetOption[]>
  /** Delete a Bot.
   * @param botId - Bot to delete.
   */
  remove(botId: BotId): Promise<void>
  /** Replace a Bot's mutable profile fields.
   * @param input - Bot identity and the fields to replace.
   * @returns the authoritative Bot after the update.
   */
  update(input: BotUpdateRequest): Promise<BotView>
  /** Create a room over the selected Bots.
   * @param input - room name and member Bots.
   * @returns the created room.
   */
  createRoom(input: { readonly name: string; readonly memberIds: readonly BotId[] }): Promise<RoomView>
  /** Delete a room.
   * @param roomId - Room to delete.
   */
  deleteRoom(roomId: RoomId): Promise<void>
  /** Rename a room.
   * @param input - room and its new display name.
   * @returns the room after the edit.
   */
  renameRoom(input: BotRoomRenameRequest): Promise<RoomView>
  /** Add one Bot to a room.
   * @param roomId - Room to edit.
   * @param botId - Bot to add.
   */
  addRoomMember(roomId: RoomId, botId: BotId): Promise<unknown>
  /** Remove one Bot from a room.
   * @param roomId - Room to edit.
   * @param botId - Bot to remove.
   */
  removeRoomMember(roomId: RoomId, botId: BotId): Promise<unknown>
  /** Load one room's durable message log.
   * @param roomId - Room whose log is loaded.
   */
  loadRoomMessages(roomId: RoomId): Promise<unknown>
  /** Post one message into a room.
   * @param roomId - Room receiving the message.
   * @param text - Message body with optional `@member` mentions.
   */
  postRoomMessage(roomId: RoomId, text: string): Promise<unknown>
  /** Cached messages of one room.
   * @param roomId - Room whose log is read.
   */
  messagesOf(roomId: RoomId): readonly RoomMessageView[]
  /** Member Bots currently working in one room.
   * @param roomId - Room whose activity is read.
   */
  workingOf(roomId: RoomId): ReadonlySet<string>
}

/** Which conversation the pane shows; `home` is the roster and creation form. */
type Selection =
  | { readonly kind: 'home' }
  | { readonly kind: 'bot'; readonly botId: BotId }
  | { readonly kind: 'room'; readonly roomId: RoomId }

type PaneTranslate = PropsLocale<'bot.roster'>['t']

/** Address with a retry nonce: a new attempt is a new resource address, so the provider reopens. */
function withAttempt(address: string, attempt: number): string {
  return attempt === 0 ? address : `${address}?attempt=${String(attempt)}`
}

/** Opening and failure state of one Bot conversation. */
function OpeningPane({ failed, message, onRetry, t }: {
  readonly failed: boolean
  readonly message: string | undefined
  readonly onRetry: () => void
  readonly t: PaneTranslate
}): React.ReactNode {
  return (
    <div className={css.pending} role={failed ? 'alert' : 'status'}>
      <StateDot state={failed ? 'error' : 'ongoing'} />
      {failed
        ? (
          <>
            <span title={message}>{t('openFailed')}</span>
            <Button variant="outline" size="sm" onClick={onRetry}>{t('retry')}</Button>
          </>
        )
        : t('opening')}
    </div>
  )
}

/** Render the Bots rail and the pane it selects: a chat, a room, or the roster.
 * @param props - Bot state, Workspace choices, actions, and localized copy.
 * @returns the Bots panel.
 */
export function BotManagerPage(props: BotManagerPageProps): React.ReactNode {
  const {
    useList, useRooms, workspaces, create, remove, update, createRoom, deleteRoom, renameRoom,
    addRoomMember, removeRoomMember, loadRoomMessages, postRoomMessage,
    loadPermissionOptions, messagesOf, workingOf, t,
    SessionProvider, renderSlot, useResource,
  } = props
  const snapshot = useList((value: BotSnapshot) => value)
  const roomsState = useRooms((value: RoomSnapshot) => value)
  const [selection, setSelection] = useState<Selection>({ kind: 'home' })
  const [attempt, setAttempt] = useState(0)
  const [infoOpen, setInfoOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [preset, setPreset] = useState('standard')
  // No workspace by default: a new Bot is a pure chat teammate unless the
  // creator gives it a home workspace.
  const [workspaceId, setWorkspaceId] = useState<WorkspaceId | undefined>(undefined)
  const [permission, setPermission] = useState('')
  const [permissionOptions, setPermissionOptions] = useState<readonly PresetOption[] | undefined>(undefined)
  const [failed, setFailed] = useState(false)
  const [selected, setSelected] = useState<BotId[]>([])

  useEffect(() => {
    let live = true
    void loadPermissionOptions().then(
      (list) => { if (live) setPermissionOptions(list) },
      // A failed catalog stays silent here: creation follows the deployment
      // default, and the info drawer reports its own load failure.
      () => { if (live) setPermissionOptions([]) },
    )
    return () => { live = false }
  }, [loadPermissionOptions])

  const activeBot = selection.kind === 'bot'
    ? snapshot.bots.find(bot => String(bot.botId) === String(selection.botId))
    : undefined
  const activeRoom = selection.kind === 'room'
    ? roomsState.rooms.find(room => String(room.roomId) === String(selection.roomId))
    : undefined
  // A deleted Bot or a deleted room falls back to the roster.
  useEffect(() => {
    if (selection.kind === 'bot' && activeBot === undefined && snapshot.phase === 'ready') {
      setSelection({ kind: 'home' })
    }
    if (selection.kind === 'room' && activeRoom === undefined && roomsState.phase === 'ready') {
      setSelection({ kind: 'home' })
    }
  }, [selection, activeBot, activeRoom, snapshot.phase, roomsState.phase])

  const select = (next: Selection): void => {
    setAttempt(0)
    setInfoOpen(false)
    setSelection(next)
  }
  const openInfo = (): void => { setInfoOpen(true) }
  const chatResource = useResource<'botchat'>(
    selection.kind === 'bot' ? withAttempt(botChatAddress(selection.botId), attempt) : '',
  )

  const run = (action: () => Promise<unknown>): void => {
    void action().then(() => {
      setFailed(false)
    }, () => {
      setFailed(true)
    })
  }
  const selectedBots = snapshot.bots.filter(bot => selected.some(id => String(id) === String(bot.botId)))
  const toggleSelected = (botId: BotId): void => {
    setSelected(current => current.some(id => String(id) === String(botId))
      ? current.filter(id => String(id) !== String(botId))
      : [...current, botId])
  }

  const pane = ((): React.ReactNode => {
    if (selection.kind === 'bot' && activeBot !== undefined) {
      const reference = chatResource.value?.reference
      if (reference === undefined) {
        return (
          <OpeningPane
            failed={chatResource.status === 'failed'}
            message={chatResource.failure?.message}
            onRetry={() => { setAttempt(current => current + 1) }}
            t={t}
          />
        )
      }
      return (
        <SessionProvider session={reference}>
          {renderSlot('bot.chat', { bot: activeBot })}
        </SessionProvider>
      )
    }
    if (selection.kind === 'room' && activeRoom !== undefined) {
      return (
        <RoomPane
          room={activeRoom}
          bots={snapshot.bots}
          messages={messagesOf(activeRoom.roomId)}
          working={workingOf(activeRoom.roomId)}
          loadMessages={loadRoomMessages}
          post={postRoomMessage}
          onOpenInfo={openInfo}
          t={t}
        />
      )
    }
    return (
      <div className={css.pageScroll}>
        <div className={css.pageContent}>
          <header className={css.header}>
            <div>
              <h1 className={css.title}>{t('title')}</h1>
              <p className={css.intro}>{t('intro')}</p>
            </div>
            {snapshot.phase === 'ready' && snapshot.bots.length > 0 && (
              <span className={css.count}>{snapshot.bots.length}</span>
            )}
            {selectedBots.length > 0 && (
              <Button
                variant="primary"
                size="sm"
                className={css.groupButton}
                icon={<IconUsersOutlineRegular size={14} />}
                onClick={() => {
                  run(async () => {
                    const room = await createRoom({
                      name: selectedBots.map(bot => bot.name).join('、'),
                      memberIds: selectedBots.map(bot => bot.botId),
                    })
                    setSelected([])
                    select({ kind: 'room', roomId: room.roomId })
                  })
                }}
              >
                {t('groupChat')}
              </Button>
            )}
          </header>

          {failed && <div className={css.notice} role="alert"><StateDot state="error" />{t('error')}</div>}
          {snapshot.state === 'loading' && <div className={css.empty} role="status"><StateDot state="ongoing" />{t('loading')}</div>}
          {snapshot.state === 'error' && <div className={css.empty} role="alert"><StateDot state="error" />{t('error')}</div>}
          {snapshot.phase === 'ready' && snapshot.bots.length === 0 && (
            <div className={css.empty} role="status">
              <span className={css.emptyIcon} aria-hidden="true"><IconAgentPresetOutlineRegular size={24} /></span>
              <p>{t('empty')}</p>
            </div>
          )}

          {snapshot.bots.length > 0 && (
            <ul className={css.list}>
              {snapshot.bots.map((bot) => {
                const workspace = workspaces.find(item => item.workspaceId === bot.workspaceId)
                return (
                  <li key={String(bot.botId)}>
                    <article className={css.row}>
                      <span className={css.rowIcon} aria-hidden="true"><IconAgentPresetOutlineRegular size={24} /></span>
                      <div className={css.rowMain}>
                        <div className={css.rowHeader}>
                          <h2 className={css.name}>{bot.name}</h2>
                          <div className={css.rowActions}>
                            <input
                              className={css.selectInput}
                              type="checkbox"
                              aria-label={t('select', { name: bot.name })}
                              checked={selected.some(id => String(id) === String(bot.botId))}
                              onChange={() => { toggleSelected(bot.botId) }}
                            />
                            <Button
                              variant="outline"
                              size="sm"
                              icon={<IconNewChatOutlineRegular size={14} />}
                              onClick={() => { select({ kind: 'bot', botId: bot.botId }) }}
                            >
                              {t('chat')}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={t('deleteLabel', { name: bot.name })}
                              onClick={() => { run(() => remove(bot.botId)) }}
                            >
                              {t('delete')}
                            </Button>
                          </div>
                        </div>
                        <p className={css.description}>{bot.description}</p>
                        <div className={css.meta}>
                          <span className={css.metaItem}>{bot.preset}</span>
                          <span className={css.metaDivider}>·</span>
                          <span className={css.metaItem}>
                            {bot.workspaceId === undefined
                              ? t('workspaceNone')
                              : (workspace?.title ?? String(bot.workspaceId))}
                          </span>
                          {/* An armed teammate says so on the roster: the pin changes what the Bot may do unattended. */}
                          {bot.permission !== undefined && (
                            <>
                              <span className={css.metaDivider}>·</span>
                              <span className={css.metaItem}>{permissionLabel(bot.permission, undefined, t)}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </article>
                  </li>
                )
              })}
            </ul>
          )}

          <form
            className={css.form}
            onSubmit={(event) => {
              event.preventDefault()
              run(() => create({
                name,
                description,
                preset,
                ...permission === '' ? {} : { permission },
                ...workspaceId === undefined ? {} : { workspaceId },
              }))
            }}
          >
            <div className={css.formHead}>
              <h2 className={css.formTitle}>{t('newTitle')}</h2>
              <p className={css.formIntro}>{t('newDescription')}</p>
            </div>
            <div className={css.formGrid}>
              <label className={css.field}>
                <span>{t('name')}</span>
                <Input value={name} onChange={(event) => { setName(event.target.value) }} required />
              </label>
              <label className={css.field}>
                <span>{t('preset')}</span>
                <select
                  className={css.select}
                  value={preset}
                  onChange={(event) => { setPreset(event.target.value) }}
                  required
                >
                  <option value="standard">{t('presetStandard')}</option>
                </select>
              </label>
              <label className={css.fieldWide}>
                <span>{t('description')}</span>
                <Input value={description} onChange={(event) => { setDescription(event.target.value) }} required />
              </label>
              <label className={css.field}>
                <span>{t('workspace')}</span>
                <select
                  className={css.select}
                  value={workspaceId === undefined ? '' : String(workspaceId)}
                  onChange={(event) => {
                    const next = workspaces.find(workspace => String(workspace.workspaceId) === event.target.value)
                    setWorkspaceId(next?.workspaceId)
                  }}
                >
                  <option value="">{t('workspaceNone')}</option>
                  {workspaces.map(workspace => (
                    <option key={String(workspace.workspaceId)} value={workspace.workspaceId}>
                      {workspace.title}
                    </option>
                  ))}
                </select>
              </label>
              {permissionOptions !== undefined && permissionOptions.length > 0 && (
                <label className={css.field}>
                  <span>{t('permission')}</span>
                  <select
                    className={css.select}
                    value={permission}
                    onChange={(event) => { setPermission(event.target.value) }}
                  >
                    <option value="">{t('permissionFollow')}</option>
                    {permissionOptions.map(option => (
                      <option key={option.value} value={option.value}>
                        {permissionLabel(option.value, permissionOptions, t)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            <Button
              type="submit"
              variant="primary"
              className={css.createButton}
              icon={<IconPlusOutlineRegular size={14} />}
            >
              {t('create')}
            </Button>
          </form>
        </div>
      </div>
    )
  })()

  return (
    <PanelInfoContext.Provider value={openInfo}>
      <section className={css.panel} aria-label={t('title')}>
        <aside className={css.rail} aria-label={t('rail')}>
          <header className={css.railHead}>
            <h1 className={css.railTitle}>{t('panel')}</h1>
            {snapshot.phase === 'ready' && snapshot.bots.length > 0 && (
              <span className={css.count}>{snapshot.bots.length}</span>
            )}
          </header>
          <div className={css.railScroll}>
            {snapshot.bots.length > 0 && (
              <>
                <p className={css.railSection}>{t('dmSection')}</p>
                <ul className={css.railList}>
                  {snapshot.bots.map(bot => (
                    <li key={String(bot.botId)}>
                      <button
                        type="button"
                        className={clsx(css.railRow, selection.kind === 'bot'
                          && String(selection.botId) === String(bot.botId) && css.railRowActive)}
                        aria-current={selection.kind === 'bot' && String(selection.botId) === String(bot.botId)}
                        onClick={() => { select({ kind: 'bot', botId: bot.botId }) }}
                      >
                        <span className={css.railAvatar} aria-hidden="true">
                          {bot.avatar === undefined
                            ? bot.name.slice(0, 1)
                            : <img className={css.railAvatarImage} src={bot.avatar} alt="" />}
                        </span>
                        <span className={css.railName}>{bot.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {roomsState.rooms.length > 0 && (
              <>
                <p className={css.railSection}>{t('roomSection')}</p>
                <ul className={css.railList}>
                  {roomsState.rooms.map(room => (
                    <li key={String(room.roomId)}>
                      <button
                        type="button"
                        className={clsx(css.railRow, selection.kind === 'room'
                          && String(selection.roomId) === String(room.roomId) && css.railRowActive)}
                        aria-current={selection.kind === 'room' && String(selection.roomId) === String(room.roomId)}
                        onClick={() => { select({ kind: 'room', roomId: room.roomId }) }}
                      >
                        <span className={clsx(css.railAvatar, css.railRoomAvatar)} aria-hidden="true">
                          <IconUsersOutlineRegular size={14} />
                        </span>
                        <span className={css.railName}>{room.name}</span>
                        <span className={css.railMeta}>{room.members.length}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
          <footer className={css.railFoot}>
            <Button
              variant="outline"
              size="sm"
              className={css.railNew}
              icon={<IconPlusOutlineRegular size={14} />}
              onClick={() => { select({ kind: 'home' }) }}
            >
              {t('newAction')}
            </Button>
          </footer>
        </aside>
        <div className={css.pane}>
          {pane}
          {infoOpen && activeBot !== undefined && (
            <InfoDrawer
              key={String(activeBot.botId)}
              bot={activeBot}
              room={undefined}
              bots={snapshot.bots}
              onClose={() => { setInfoOpen(false) }}
              updateBot={input => update(input)}
              loadPermissionOptions={loadPermissionOptions}
              deleteBot={botId => remove(botId)}
              renameRoom={(roomId, name) => renameRoom({ roomId, name })}
              addMember={addRoomMember}
              removeMember={removeRoomMember}
              deleteRoom={roomId => deleteRoom(roomId)}
              t={t}
            />
          )}
          {infoOpen && activeBot === undefined && activeRoom !== undefined && (
            <InfoDrawer
              key={String(activeRoom.roomId)}
              bot={undefined}
              room={activeRoom}
              bots={snapshot.bots}
              onClose={() => { setInfoOpen(false) }}
              updateBot={input => update(input)}
              loadPermissionOptions={loadPermissionOptions}
              deleteBot={botId => remove(botId)}
              renameRoom={(roomId, name) => renameRoom({ roomId, name })}
              addMember={addRoomMember}
              removeMember={removeRoomMember}
              deleteRoom={roomId => deleteRoom(roomId)}
              t={t}
            />
          )}
        </div>
      </section>
    </PanelInfoContext.Provider>
  )
}
