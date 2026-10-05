/** One room conversation: member header, shared timeline, and composer. */

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Button, IconEllipsisOutlineRegular, IconUsersOutlineRegular, MarkdownText, StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  BotView, RoomId, RoomMessageView, RoomView,
} from '@deepseek-ai/dsh-api-bot-controller/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import css from './RoomPane.module.css'

/** Props for the room conversation pane. */
export interface RoomPaneProps {
  readonly room: RoomView
  /** Full Bot roster, for resolving member display names. */
  readonly bots: readonly BotView[]
  /** Messages currently cached for the room, in append order. */
  readonly messages: readonly RoomMessageView[]
  /** Member Bot ids with a delivery in flight. */
  readonly working: ReadonlySet<string>
  /** Load the durable log for a room. */
  readonly loadMessages: (roomId: RoomId) => Promise<unknown>
  /** Post one message; mentions inside are resolved on the Host. */
  readonly post: (roomId: RoomId, text: string) => Promise<unknown>
  /** Open the right-hand info drawer for this room. */
  readonly onOpenInfo: () => void
  readonly t: PropsLocale<'bot.roster'>['t']
}

/**
 * Render one room: the member header with its info entry, the shared message
 * timeline, and a composer whose member chips insert `@name` mentions.
 * Renaming, membership, and deletion live in the info drawer.
 * @param props - Room identity, roster, cached log, and commands.
 * @returns the room pane.
 */
export function RoomPane({
  room, bots, messages, working, loadMessages, post, onOpenInfo, t,
}: RoomPaneProps): React.ReactNode {
  const [loadFailed, setLoadFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [text, setText] = useState('')
  const [posting, setPosting] = useState(false)
  const [postFailed, setPostFailed] = useState(false)
  const timeline = useRef<HTMLDivElement | null>(null)

  // The log is fetched once per room (and per retry); later messages arrive
  // through the room stream and land in `messages` without a refetch.
  useEffect(() => {
    let cancelled = false
    setLoadFailed(false)
    void loadMessages(room.roomId).then(
      () => {},
      () => { if (!cancelled) setLoadFailed(true) },
    )
    return () => { cancelled = true }
  }, [room.roomId, attempt])

  useEffect(() => {
    const element = timeline.current
    if (element !== null) element.scrollTop = element.scrollHeight
  }, [messages.length])

  const labels = useMemo<MarkdownLabels>(() => ({
    code: {
      copyLabel: t('copy'),
      copiedLabel: t('copied'),
      toolbarLabels: { codeLabel: t('code'), wrapLabel: t('wrap'), unwrapLabel: t('unwrap') },
    },
    footnotes: t('footnotes'),
  }), [t])

  const workingCount = working.size

  const send = (): void => {
    const body = text.trim()
    if (body === '' || posting) return
    setPosting(true)
    setPostFailed(false)
    void post(room.roomId, body).then(
      () => { setText(''); setPosting(false) },
      () => { setPostFailed(true); setPosting(false) },
    )
  }
  const insertMention = (name: string): void => {
    setText(current => `${current}${current === '' || current.endsWith(' ') ? '' : ' '}@${name} `)
  }

  return (
    <section className={css.page} aria-label={room.name}>
      <header className={css.header}>
        <span className={css.roomAvatar} aria-hidden="true"><IconUsersOutlineRegular size={18} /></span>
        <div className={css.identity}>
          <h1 className={css.name}>{room.name}</h1>
          <p className={css.members} aria-label={t('memberListLabel')}>
            {room.members.map(member => member.name).join('、')}
          </p>
        </div>
        <span className={css.state}>
          <StateDot state={workingCount > 0 ? 'ongoing' : 'idle'} />
          {workingCount > 0 ? t('membersWorking', { count: workingCount }) : t('idle')}
        </span>
        <div className={css.actions}>
          <Button
            variant="ghost"
            size="sm"
            icon={<IconEllipsisOutlineRegular size={14} />}
            onClick={onOpenInfo}
          >
            {t('roomInfo')}
          </Button>
        </div>
      </header>

      <div className={css.timeline} ref={timeline} aria-label={t('timelineLabel')}>
        {messages.length === 0 && !loadFailed && (
          <div className={css.empty} role="status">
            <IconUsersOutlineRegular size={24} />
            <p>{t('roomEmpty')}</p>
            <p className={css.emptyHint}>{t('roomEmptyHint')}</p>
          </div>
        )}
        {loadFailed && (
          <div className={css.empty} role="alert">
            <StateDot state="error" />
            <p>{t('roomLoadFailed')}</p>
            <Button variant="outline" size="sm" onClick={() => { setAttempt(value => value + 1) }}>{t('retry')}</Button>
          </div>
        )}
        {messages.map(message => (
          <RoomMessage
            key={String(message.messageId)}
            message={message}
            labels={labels}
            working={message.senderId !== undefined && working.has(String(message.senderId))}
            t={t}
          />
        ))}
        {workingCount > 0 && (
          <div className={css.thinking} role="status">
            <StateDot state="ongoing" />
            {t('thinking', { names: [...working].map(id => botName(bots, id)).join('、') })}
          </div>
        )}
      </div>

      <footer className={css.composer}>
        <div className={css.mentionBar}>
          {room.members.map(member => (
            <button
              key={String(member.botId)}
              type="button"
              className={css.mentionChip}
              onClick={() => { insertMention(member.name) }}
            >
              @{member.name}
            </button>
          ))}
        </div>
        <div className={css.inputRow}>
          <textarea
            className={css.input}
            value={text}
            placeholder={t('roomPlaceholder')}
            aria-label={t('roomPlaceholder')}
            rows={2}
            onChange={(event) => { setText(event.target.value) }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                send()
              }
            }}
          />
          <Button
            variant="primary"
            className={css.send}
            disabled={text.trim() === '' || posting}
            onClick={send}
          >
            {posting ? t('sending') : t('send')}
          </Button>
        </div>
        {postFailed && <p className={css.editError} role="alert">{t('postFailed')}</p>}
      </footer>
    </section>
  )
}

/** One timeline entry, styled by its author class. */
function RoomMessage({ message, labels, working, t }: {
  readonly message: RoomMessageView
  readonly labels: MarkdownLabels
  readonly working: boolean
  readonly t: PropsLocale<'bot.roster'>['t']
}): React.ReactNode {
  if (message.senderKind === 'system') {
    return <div className={css.systemRow}>{message.text}</div>
  }
  if (message.senderKind === 'user') {
    return (
      <div className={css.userRow}>
        <div className={css.userBubble}>{message.text}</div>
      </div>
    )
  }
  return (
    <div className={css.botRow}>
      <span className={css.botAvatar} aria-hidden="true">{message.senderName.slice(0, 1)}</span>
      <div className={css.botBody}>
        <div className={css.botHead}>
          <span className={css.botName}>{message.senderName}</span>
          {working && <span className={css.workingTag}><StateDot state="ongoing" />{t('working')}</span>}
        </div>
        <div className={css.botText}>
          <MarkdownText text={message.text} labels={labels} variant="compact" />
        </div>
      </div>
    </div>
  )
}

/** Display name for one member id, falling back to the id. */
function botName(bots: readonly BotView[], botId: string): string {
  return bots.find(bot => String(bot.botId) === botId)?.name ?? botId
}
