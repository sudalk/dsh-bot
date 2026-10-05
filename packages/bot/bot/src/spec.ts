/**
 * The Bot domain declaration: record schema, registry order, and the
 * `defineDomain` spec the registry opens. The zod schema validates the
 * shipped format at the durability boundary.
 * @module @deepseek-ai/dsh-bot/src/spec
 */

import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { BotId } from './types.ts'

/** Bot id schema at the durable boundary; branding has no runtime representation. */
const botId = z.string().transform(value => value as BotId)

const workspaceId = z.string().transform(value => brandString<WorkspaceId>(value))

const sessionId = z.string().transform(value => value as SessionId)

/**
 * Durable shape of one Bot record. `name` is display data and `description`
 * carries the standing rules; `preset` and `workspaceId` decide how every
 * conversation with this Bot composes, so they are part of the record rather
 * than of any one Session header. Timestamps are ISO-8601 strings.
 */
export const botRecord = z.object({
  name: z.string(),
  description: z.string(),
  preset: z.string(),
  /**
   * Avatar image as a data URL. Absent on records written before avatars
   * existed and on Bots that never uploaded one; clearing also removes the
   * key, so the empty string is never persisted.
   */
  avatar: z.string().optional(),
  /**
   * Permission preset this Bot's conversations run under. Absent on records
   * written before per-Bot permissions existed and on Bots that follow the
   * deployment default; clearing also removes the key, so the empty string is
   * never persisted.
   */
  permission: z.string().optional(),
  workspaceId,
  /**
   * The Bot's one continuing conversation. Absent on records written before
   * conversations were part of the record; the consumer creates and adopts
   * one on first open and writes it back through {@link Bot.setConversation}.
   */
  conversationId: sessionId.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

/** One stored Bot record, inferred from {@link botRecord}. */
export type BotRecord = z.infer<typeof botRecord>

/**
 * Durable registry state. `botIds` is the authoritative roster order
 * (newest first) and is the only state the registry persists outside the
 * records themselves.
 */
export const botDomainState = z.object({
  botIds: z.array(botId),
})

/** Durable registry state inferred from {@link botDomainState}. */
export type BotDomainState = z.infer<typeof botDomainState>

/**
 * The Bot domain spec: one `bots` table keyed by {@link BotId} plus the
 * roster-order singleton. The registry opens this through
 * `ctx.storageDomain`; the spec object is the single source of the domain's
 * identity, version, and schemas.
 */
export const botDomainSpec = defineDomain({
  name: 'bot',
  version: 1,
  global: {
    schema: botDomainState,
    initial: { botIds: [] },
  },
  tables: { bots: domainTable<BotId, BotRecord>(botRecord) },
})
