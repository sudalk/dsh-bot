/**
 * Right-hand info drawer for the selected conversation: a Bot's profile
 * (rename the Bot, edit its job, delete it) or a room's settings (rename the
 * group, manage members, delete it). Opened from the conversation header,
 * mirroring the familiar chat-app pattern.
 */

import { useEffect, useRef, useState } from 'react'
import {
  Button, IconCloseOutlineRegular, IconPlusOutlineRegular, Input,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  BotId, BotView, RoomId, RoomView,
} from '@deepseek-ai/dsh-api-bot-controller/client'
import type { PresetOption } from '@deepseek-ai/dsh-permission-presets/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { fileToAvatarDataUrl } from './avatar.ts'
import { permissionLabel } from './permission-display.ts'
import css from './InfoDrawer.module.css'

/** Mirrors the Host's membership bounds; the Host enforces them authoritatively. */
const MEMBERS_MIN = 2
const MEMBERS_MAX = 6

/** Props for the info drawer. */
export interface InfoDrawerProps {
  /** Bot whose profile is shown; `undefined` while a room is selected. */
  readonly bot: BotView | undefined
  /** Room whose settings are shown; `undefined` while a Bot is selected. */
  readonly room: RoomView | undefined
  /** Full Bot roster, for the member picker. */
  readonly bots: readonly BotView[]
  /** Close the drawer. */
  readonly onClose: () => void
  /** Replace the Bot's name, job, and/or avatar. */
  readonly updateBot: (input: {
    readonly botId: BotId
    readonly name?: string
    readonly description?: string
    /** Avatar data URL to replace in place; the empty string clears it. */
    readonly avatar?: string
    /** Permission preset to pin; the empty string returns to the deployment default. */
    readonly permission?: string
  }) => Promise<unknown>
  /** Load the permission presets a Bot may pin; the empty list hides the control. */
  readonly loadPermissionOptions: () => Promise<readonly PresetOption[]>
  /** Delete the Bot; its conversations and group memberships stay on disk. */
  readonly deleteBot: (botId: BotId) => Promise<unknown>
  /** Rename the room. */
  readonly renameRoom: (roomId: RoomId, name: string) => Promise<unknown>
  /** Add one Bot to the room. */
  readonly addMember: (roomId: RoomId, botId: BotId) => Promise<unknown>
  /** Remove one Bot from the room. */
  readonly removeMember: (roomId: RoomId, botId: BotId) => Promise<unknown>
  /** Delete the room and its message log. */
  readonly deleteRoom: (roomId: RoomId) => Promise<unknown>
  readonly t: PropsLocale<'bot.roster'>['t']
}

/**
 * Render the info drawer for whichever conversation is selected.
 * @param props - Selection, roster, and commands.
 * @returns the drawer with its backdrop.
 */
export function InfoDrawer(props: InfoDrawerProps): React.ReactNode {
  const { bot, room, onClose, t } = props

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey) }
  }, [onClose])

  return (
    <>
      <div className={css.backdrop} onClick={onClose} aria-hidden="true" />
      <aside
        className={css.drawer}
        role="complementary"
        aria-label={bot === undefined ? t('roomInfo') : t('botInfo')}
      >
        <header className={css.head}>
          <h2 className={css.title}>{bot === undefined ? t('roomInfo') : t('botInfo')}</h2>
          <button
            type="button"
            className={css.close}
            aria-label={t('closePanel')}
            onClick={onClose}
          >
            <IconCloseOutlineRegular size={16} />
          </button>
        </header>
        <div className={css.body}>
          {bot !== undefined && <BotSection {...props} bot={bot} />}
          {bot === undefined && room !== undefined && <RoomSection {...props} room={room} />}
        </div>
        <footer className={css.footer}>
          {bot !== undefined && <DeleteBotAction {...props} bot={bot} />}
          {bot === undefined && room !== undefined && <DeleteRoomAction {...props} room={room} />}
        </footer>
      </aside>
    </>
  )
}

/** Always-visible footer action: delete the Bot after an inline confirmation. */
function DeleteBotAction({
  bot, onClose, deleteBot, t,
}: InfoDrawerProps & { readonly bot: BotView }): React.ReactNode {
  const [confirming, setConfirming] = useState(false)
  if (!confirming) {
    return (
      <Button variant="ghost" size="sm" className={css.danger} onClick={() => { setConfirming(true) }}>
        {t('deleteBot')}
      </Button>
    )
  }
  return (
    <div className={css.confirmRow} role="alert">
      <span className={css.confirmText}>{t('deleteBotConfirm', { name: bot.name })}</span>
      <div className={css.confirmActions}>
        <Button variant="outline" size="sm" onClick={() => { setConfirming(false) }}>{t('cancel')}</Button>
        <Button
          variant="primary"
          size="sm"
          className={css.dangerSolid}
          onClick={() => {
            void deleteBot(bot.botId).then(onClose, () => { setConfirming(false) })
          }}
        >
          {t('deleteConfirmAction')}
        </Button>
      </div>
    </div>
  )
}

/** Always-visible footer action: delete the room after an inline confirmation. */
function DeleteRoomAction({
  room, onClose, deleteRoom, t,
}: InfoDrawerProps & { readonly room: RoomView }): React.ReactNode {
  const [confirming, setConfirming] = useState(false)
  if (!confirming) {
    return (
      <Button variant="ghost" size="sm" className={css.danger} onClick={() => { setConfirming(true) }}>
        {t('deleteRoom')}
      </Button>
    )
  }
  return (
    <div className={css.confirmRow} role="alert">
      <span className={css.confirmText}>{t('deleteConfirm', { name: room.name })}</span>
      <div className={css.confirmActions}>
        <Button variant="outline" size="sm" onClick={() => { setConfirming(false) }}>{t('cancel')}</Button>
        <Button
          variant="primary"
          size="sm"
          className={css.dangerSolid}
          onClick={() => {
            void deleteRoom(room.roomId).then(onClose, () => { setConfirming(false) })
          }}
        >
          {t('deleteConfirmAction')}
        </Button>
      </div>
    </div>
  )
}

/** Saved/unsaved feedback shared by both section forms. */
type Feedback = 'idle' | 'saved' | 'failed'

/** The Bot profile form: rename, edit the job, delete. */
function BotSection({
  bot, updateBot, loadPermissionOptions, t,
}: InfoDrawerProps & { readonly bot: BotView }): React.ReactNode {
  const [name, setName] = useState(bot.name)
  const [description, setDescription] = useState(bot.description)
  const [nameFeedback, setNameFeedback] = useState<Feedback>('idle')
  const [descriptionFeedback, setDescriptionFeedback] = useState<Feedback>('idle')
  const [avatarFeedback, setAvatarFeedback] = useState<Feedback>('idle')
  const avatarInput = useRef<HTMLInputElement>(null)

  const saveName = (): void => {
    setNameFeedback('idle')
    void updateBot({ botId: bot.botId, name: name.trim() }).then(
      () => { setNameFeedback('saved') },
      () => { setNameFeedback('failed') },
    )
  }
  const saveDescription = (): void => {
    setDescriptionFeedback('idle')
    void updateBot({ botId: bot.botId, description: description.trim() }).then(
      () => { setDescriptionFeedback('saved') },
      () => { setDescriptionFeedback('failed') },
    )
  }
  const applyAvatar = (avatar: string): void => {
    setAvatarFeedback('idle')
    void updateBot({ botId: bot.botId, avatar }).then(
      () => { setAvatarFeedback('saved') },
      () => { setAvatarFeedback('failed') },
    )
  }
  const pickAvatar = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file === undefined) return
    setAvatarFeedback('idle')
    void fileToAvatarDataUrl(file).then(
      (dataUrl) => { applyAvatar(dataUrl) },
      () => { setAvatarFeedback('failed') },
    )
  }

  return (
    <>
      <div className={css.identity}>
        <button
          type="button"
          className={css.avatarButton}
          aria-label={t('changeAvatar')}
          title={t('changeAvatar')}
          onClick={() => { avatarInput.current?.click() }}
        >
          {bot.avatar === undefined
            ? <span className={css.avatar} aria-hidden="true">{bot.name.slice(0, 1)}</span>
            : <img className={css.avatarImage} src={bot.avatar} alt="" />}
        </button>
        <input
          ref={avatarInput}
          className={css.fileInput}
          type="file"
          accept="image/*"
          aria-label={t('chooseAvatarFile')}
          onChange={pickAvatar}
        />
        <div className={css.identityMain}>
          <p className={css.identityName}>{bot.name}</p>
          <p className={css.identityMeta}>{bot.preset}</p>
        </div>
      </div>
      {avatarFeedback === 'saved' && <p className={css.hint}>{t('saved')}</p>}
      {avatarFeedback === 'failed' && <p className={css.error} role="alert">{t('avatarFailed')}</p>}
      {bot.avatar !== undefined && (
        <div className={css.avatarActions}>
          <Button variant="ghost" size="sm" onClick={() => { applyAvatar('') }}>
            {t('removeAvatar')}
          </Button>
        </div>
      )}

      <section className={css.section}>
        <span className={css.label}>{t('name')}</span>
        <div className={css.fieldRow}>
          <Input
            value={name}
            onChange={(event) => { setName(event.target.value); setNameFeedback('idle') }}
          />
          <Button
            variant="primary"
            size="sm"
            disabled={name.trim() === '' || name.trim() === bot.name}
            onClick={saveName}
          >
            {t('save')}
          </Button>
        </div>
        {nameFeedback === 'saved' && <p className={css.hint}>{t('saved')}</p>}
        {nameFeedback === 'failed' && <p className={css.error} role="alert">{t('saveFailed')}</p>}
      </section>

      <section className={css.section}>
        <span className={css.label}>{t('description')}</span>
        <textarea
          className={css.textarea}
          rows={4}
          value={description}
          onChange={(event) => { setDescription(event.target.value); setDescriptionFeedback('idle') }}
        />
        <div className={css.fieldRowEnd}>
          <Button
            variant="primary"
            size="sm"
            disabled={description.trim() === '' || description.trim() === bot.description}
            onClick={saveDescription}
          >
            {t('save')}
          </Button>
        </div>
        {descriptionFeedback === 'saved' && <p className={css.hint}>{t('saved')}</p>}
        {descriptionFeedback === 'failed' && <p className={css.error} role="alert">{t('saveFailed')}</p>}
      </section>

      <PermissionSection bot={bot} updateBot={updateBot} loadPermissionOptions={loadPermissionOptions} t={t} />
    </>
  )
}

/**
 * The Bot's permission pin: the preset every conversation with this Bot runs
 * under, including the conversations it opens on its own. The control writes
 * on pick — there is no draft to stage, and the roster shows the result.
 */
function PermissionSection({
  bot, updateBot, loadPermissionOptions, t,
}: Pick<InfoDrawerProps, 'updateBot' | 'loadPermissionOptions' | 't'> & { readonly bot: BotView }): React.ReactNode {
  const [options, setOptions] = useState<readonly PresetOption[] | undefined>(undefined)
  const [feedback, setFeedback] = useState<Feedback | 'unavailable'>('idle')

  useEffect(() => {
    let live = true
    void loadPermissionOptions().then(
      (list) => { if (live) setOptions(list) },
      () => { if (live) setFeedback('unavailable') },
    )
    return () => { live = false }
  }, [loadPermissionOptions])

  if (feedback === 'unavailable') {
    return (
      <section className={css.section}>
        <span className={css.label}>{t('permission')}</span>
        <p className={css.error} role="alert">{t('permissionLoadFailed')}</p>
      </section>
    )
  }
  // No advertised preset means this deployment composes no permission service:
  // the capability is absent, not pending, so the control stays out of the form.
  if (options === undefined || options.length === 0) return null

  const pinned = bot.permission
  const value = pinned ?? ''
  const advertised = pinned === undefined || options.some(option => option.value === pinned)
  const description = options.find(option => option.value === value)?.description

  return (
    <section className={css.section}>
      <span className={css.label}>{t('permission')}</span>
      <select
        className={css.select}
        aria-label={t('permission')}
        value={value}
        onChange={(event) => {
          const next = event.target.value
          setFeedback('idle')
          void updateBot({ botId: bot.botId, permission: next }).then(
            () => { setFeedback('saved') },
            () => { setFeedback('failed') },
          )
        }}
      >
        <option value="">{t('permissionFollow')}</option>
        {options.map(option => (
          <option key={option.value} value={option.value}>
            {permissionLabel(option.value, options, t)}
          </option>
        ))}
        {/* A pin this deployment no longer advertises stays selectable so it is visible and clearable. */}
        {!advertised && <option value={pinned}>{pinned}</option>}
      </select>
      <p className={css.note}>{description ?? t('permissionHint')}</p>
      {feedback === 'saved' && <p className={css.hint}>{t('saved')}</p>}
      {feedback === 'failed' && <p className={css.error} role="alert">{t('saveFailed')}</p>}
    </section>
  )
}

/** The room settings form: rename the group, manage members, delete. */
function RoomSection({
  room, bots, renameRoom, addMember, removeMember, t,
}: InfoDrawerProps & { readonly room: RoomView }): React.ReactNode {
  const [name, setName] = useState(room.name)
  const [nameFeedback, setNameFeedback] = useState<Feedback>('idle')
  const [editFailed, setEditFailed] = useState(false)
  const [adding, setAdding] = useState(false)

  const memberIds = new Set(room.members.map(member => String(member.botId)))
  const nonMembers = bots.filter(bot => !memberIds.has(String(bot.botId)))
  const rosterById = new Map(bots.map(bot => [String(bot.botId), bot]))
  const atFloor = room.members.length <= MEMBERS_MIN
  const full = room.members.length >= MEMBERS_MAX

  const saveName = (): void => {
    setNameFeedback('idle')
    void renameRoom(room.roomId, name.trim()).then(
      () => { setNameFeedback('saved') },
      () => { setNameFeedback('failed') },
    )
  }
  const edit = (action: () => Promise<unknown>): void => {
    setEditFailed(false)
    void action().catch(() => { setEditFailed(true) })
  }

  return (
    <>
      <div className={css.identity}>
        <span className={css.avatar} aria-hidden="true">{room.name.slice(0, 1)}</span>
        <div className={css.identityMain}>
          <p className={css.identityName}>{room.name}</p>
          <p className={css.identityMeta}>{room.members.map(member => member.name).join('、')}</p>
        </div>
      </div>

      <section className={css.section}>
        <span className={css.label}>{t('roomNameLabel')}</span>
        <div className={css.fieldRow}>
          <Input
            value={name}
            onChange={(event) => { setName(event.target.value); setNameFeedback('idle') }}
          />
          <Button
            variant="primary"
            size="sm"
            disabled={name.trim() === '' || name.trim() === room.name}
            onClick={saveName}
          >
            {t('save')}
          </Button>
        </div>
        {nameFeedback === 'saved' && <p className={css.hint}>{t('saved')}</p>}
        {nameFeedback === 'failed' && <p className={css.error} role="alert">{t('saveFailed')}</p>}
      </section>

      <section className={css.section}>
        <span className={css.label}>{t('membersTitle', { count: room.members.length, max: MEMBERS_MAX })}</span>
        <div className={css.memberGrid}>
          {room.members.map((member) => {
            const memberAvatar = rosterById.get(String(member.botId))?.avatar
            return (
              <div key={String(member.botId)} className={css.memberTile}>
                <span className={css.memberAvatar} aria-hidden="true">
                  {memberAvatar === undefined
                    ? member.name.slice(0, 1)
                    : <img className={css.memberAvatarImage} src={memberAvatar} alt="" />}
                </span>
                <span className={css.memberName} title={member.name}>{member.name}</span>
                <button
                  type="button"
                  className={css.memberRemove}
                  aria-label={t('removeMemberLabel', { name: member.name })}
                  disabled={atFloor}
                  onClick={() => { edit(() => removeMember(room.roomId, member.botId)) }}
                >
                  ×
                </button>
              </div>
            )
          })}
          {!full && (
            <button
              type="button"
              className={css.addTile}
              aria-label={t('addTitle')}
              onClick={() => { setAdding(value => !value) }}
            >
              <IconPlusOutlineRegular size={16} />
            </button>
          )}
        </div>
        {adding && (
          <ul className={css.addList}>
            {nonMembers.map(bot => (
              <li key={String(bot.botId)} className={css.addRow}>
                <span className={css.addName}>{bot.name}</span>
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={t('addMemberLabel', { name: bot.name })}
                  onClick={() => { edit(() => addMember(room.roomId, bot.botId)) }}
                >
                  {t('add')}
                </Button>
              </li>
            ))}
            {nonMembers.length === 0 && <li className={css.addEmpty}>{t('noAddableMembers')}</li>}
          </ul>
        )}
        {editFailed && <p className={css.error} role="alert">{t('memberEditFailed')}</p>}
      </section>
    </>
  )
}
