/**
 * Public type vocabulary of the Bot entity: the `BotId` brand, the
 * `BotProfile` a caller writes, and the `Bot` consumer interface. Types only
 * — the id factory lives in `index.ts` (this file carries no runtime code).
 * @module @deepseek-ai/dsh-bot/src/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-typert-protocol'

/**
 * Identifies one Bot record. A generated uuid, never the name: names are
 * mutable display data, and a reference anchor must stay stable.
 */
export type BotId = Branded<'BotId'>

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** No Bot record carries that Bot identity. */
    'bot/not-found': { readonly botId: BotId }
  }
}

/**
 * The durable identity and policy of one Bot. `description` is the durable
 * rule carrier — standing responsibilities, working style, and approval
 * boundaries belong here, not in a conversation. `preset` names the agent
 * preset every conversation with this Bot is composed from, and
 * `workspaceId` optionally names the existing workspace whose directory is
 * the Bot's home; a Bot without one is a pure chat teammate running from
 * the deployment's default directory.
 */
export interface BotProfile {
  /** Display name. Duplicates across Bots are allowed; identity is {@link BotId}. */
  readonly name: string
  /**
   * Durable role description in operational terms: what the Bot owns, how it
   * works, and what it must never do without approval. Shown to the model and
   * to the roster.
   */
  readonly description: string
  /** Agent preset the Bot's conversations are composed from. */
  readonly preset: string
  /**
   * Avatar image as a data URL (`data:image/...`), or `undefined` when the
   * Bot has none. A profile update clears the avatar with the empty string.
   */
  readonly avatar?: string | undefined
  /**
   * Permission preset every conversation with this Bot runs under, or
   * `undefined` to follow the deployment default. The preset is re-applied
   * whenever an Agent composes for the Bot's conversation, so a teammate the
   * user armed with full access stays armed across restarts. A profile update
   * returns to the deployment default with the empty string; an unknown name
   * is refused at application time and leaves the deployment default in place.
   */
  readonly permission?: string | undefined
  /**
   * Existing workspace whose directory is this Bot's home, or `undefined`
   * for a pure chat Bot: the Bot owns no directory of its own, and its
   * conversations then run from the deployment's default directory.
   */
  readonly workspaceId?: WorkspaceId | undefined
}

/** Fields a caller may change after creation; identity and creation instant never change. */
export type BotProfileUpdate = Partial<BotProfile>

/**
 * Durable identity of one Bot: a named teammate with an optional home
 * workspace, and the profile that shapes every conversation it holds.
 * Consumers only see this interface; the implementation stays
 * package-private.
 */
export interface Bot {
  /** Stable record id (generated uuid). */
  readonly id: BotId

  /** Display name. */
  readonly name: string

  /** Durable role description carrying standing rules and approval boundaries. */
  readonly description: string

  /** Agent preset every conversation with this Bot is composed from. */
  readonly preset: string

  /** Avatar image as a data URL, or `undefined` when the Bot has none. */
  readonly avatar: string | undefined

  /** Permission preset this Bot's conversations run under, or `undefined` to follow the deployment default. */
  readonly permission: string | undefined

  /** Home workspace, or `undefined` for a pure chat Bot. */
  readonly workspaceId: WorkspaceId | undefined

  /**
   * The Bot's continuing conversation, created and adopted on first open.
   * Every open of a Bot's chat resumes this Session instead of creating a
   * new one; `undefined` means the conversation has not been established yet.
   */
  readonly conversationId: SessionId | undefined

  /** ISO-8601 creation instant, stamped at create and never rewritten. */
  readonly createdAt: string

  /** ISO-8601 instant of the last durable mutation (create counts as one). */
  readonly updatedAt: string

  /**
   * Replace the mutable profile fields durably. An omitted field keeps its
   * current value; a call that changes nothing resolves without writing.
   * @param update - Fields to replace; identity and timestamps are not settable.
   * @returns resolution after durability.
   */
  update(update: BotProfileUpdate): Promise<void>

  /**
   * Adopt the Session that is this Bot's continuing conversation. The first
   * open wins: a later call with a different id leaves the stored conversation
   * untouched and resolves with the id already stored.
   * @param sessionId - Session created for this Bot.
   * @returns the conversation id the record holds after the call.
   */
  adoptConversation(sessionId: SessionId): Promise<SessionId>

  /**
   * Resolve this Bot's continuing conversation, creating and adopting it on
   * the first ask and installing the Bot's identity on the Agent that
   * composes it. Concurrent asks for one Bot share a single creation.
   * @returns the durable conversation Session id.
   */
  ensureConversation(): Promise<SessionId>
}

/** Validation result for a proposed {@link BotProfile}, produced before any write. */
export type BotProfileValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string }
