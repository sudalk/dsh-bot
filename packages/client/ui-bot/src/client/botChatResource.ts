/**
 * One Bot's continuing conversation as a Client resource address: the address
 * names a Bot, and the provider resolves it to that Bot's retained Session.
 * @module @deepseek-ai/dsh-client-ui-bot/src/client/botChatResource
 */

import type { BotId } from '@deepseek-ai/dsh-api-bot-controller/client'
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'

/** Resource-address prefix for one Bot's conversation. */
export const BOT_CHAT_ADDRESS_PREFIX = 'dsh-resource://botchat/bot/'

/** Value retained by one live Bot chat resource occurrence. */
export interface BotChatResource {
  readonly botId: BotId
  readonly reference: SessionReference
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface ResourceProtocolMap {
    botchat: BotChatResource
  }
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** The resource URL does not identify a Bot. */
    'botchat/invalid-address': Record<string, never>
    /** The Bot's conversation could not be established or retained. */
    'botchat/open-failed': Record<string, never>
  }
}

/**
 * Address one Bot's continuing conversation.
 * @param botId - Bot whose chat is addressed.
 * @returns canonical resource address.
 */
export function botChatAddress(botId: BotId): string {
  return `${BOT_CHAT_ADDRESS_PREFIX}${encodeURIComponent(String(botId))}`
}

/**
 * Parse one canonical Bot chat resource address.
 * @param value - possible chat resource address.
 * @returns the addressed Bot, or undefined for another or malformed resource.
 */
export function parseBotChatAddress(value: string): BotId | undefined {
  if (!value.startsWith(BOT_CHAT_ADDRESS_PREFIX)) return undefined
  // A `?attempt=N` query is the pane's retry nonce, not part of the identity.
  const encoded = value.slice(BOT_CHAT_ADDRESS_PREFIX.length).split('?')[0] ?? ''
  if (encoded === '') return undefined
  try {
    return decodeURIComponent(encoded) as BotId
  } catch (_invalidEncoding) {
    return undefined
  }
}
