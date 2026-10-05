/** The Bot conversation hosted beside the Bots rail. */

import type { ConversationViewsProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  PropsLocale, PropsRenderFactories, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import { Button, IconEllipsisOutlineRegular, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import { useOpenPanelInfo } from './panel-info.ts'
import type { NS } from './locales.ts'
import css from './BotConversationPage.module.css'

/** Fixed view selection for an embedded conversation. */
function FixedChatConversationView(props: ConversationViewsProps) {
  return <>{props.renderSlot('conversation.session', { view: 'chat' })}</>
}

/** Props for the Bots-panel conversation pane. */
export type BotConversationPageProps =
  PropsRuntime<'bot.chat'>
  & PropsRenderFactories
  & PropsLocale<typeof NS>

/**
 * Render the selected Bot conversation: the Bot's own header over the shared
 * Conversation content. The rail switches conversations, so the pane carries
 * no back action and no Session list; each conversation is an ordinary
 * Session resumed on open.
 * @param props - Bot identity, Session seats, and localized copy.
 * @returns the conversation pane.
 */
export function BotConversationPage({
  useSession, t, bot, renderFactorySlot,
}: BotConversationPageProps): React.ReactNode {
  const session = useSession(value => value)
  const openInfo = useOpenPanelInfo()
  const started = !session.blank && !session.awaitingFirstTurn
  const live = started || session.running
  return (
    <section className={css.page} aria-label={bot.name}>
      <header className={css.header}>
        <span className={css.avatar} aria-hidden="true">
          {bot.avatar === undefined
            ? bot.name.slice(0, 1)
            : <img className={css.avatarImage} src={bot.avatar} alt="" />}
        </span>
        <div className={css.identity}>
          <h1 className={css.name}>{bot.name}</h1>
          {bot.description !== '' && <p className={css.role}>{bot.description}</p>}
        </div>
        <span className={css.state}>
          <StateDot state={session.running ? 'ongoing' : 'idle'} />
          {session.running ? t('working') : t('idle')}
        </span>
        <div className={css.actions}>
          <Button
            variant="ghost"
            size="sm"
            aria-label={t('info')}
            icon={<IconEllipsisOutlineRegular size={16} />}
            onClick={openInfo}
          />
        </div>
      </header>
      <div className={css.conversation}>
        {!live && (
          <div className={css.welcome}>
            <span className={css.welcomeAvatar} aria-hidden="true">
              {bot.avatar === undefined
                ? bot.name.slice(0, 1)
                : <img className={css.avatarImage} src={bot.avatar} alt="" />}
            </span>
            <p className={css.welcomeTitle}>{t('welcome', { name: bot.name })}</p>
            <p className={css.welcomeHint}>{t('welcomeHint')}</p>
          </div>
        )}
        {renderFactorySlot('conversation.content', {
          variant: 'embedded',
          phase: 'active',
          hero: false,
          hideModeControls: true,
          hideContextMeter: true,
        }, {
          slots: { views: FixedChatConversationView },
        })}
      </div>
    </section>
  )
}
