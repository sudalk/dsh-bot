/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-bot`.
 * @module @deepseek-ai/dsh-bot/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { DomainChanged } from '@deepseek-ai/dsh-storage-domain'
import { BotId } from '@deepseek-ai/dsh-bot'

const PACKAGE_NAME = '@deepseek-ai/dsh-bot'

/** Cordis companion plugin name. */
export const name = 'bot-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Owned relationship: the registry's entity cache mirrors the Bot domain's
 * durable table. Every `domain/changed` for the `bots` table must name a
 * record the cache already holds an entity for, in both directions — a write
 * through the registry caches before the durable put, and a delete removes
 * the entity before or with the row. A mismatch in either direction proves
 * some write path bypassed `ctx.bots`.
 */
const install: InvariantInstaller = Object.assign(
  (ctx: Context, fail: (message: string) => never) => {
    ctx.on('domain/changed', (change: DomainChanged) => {
      if (change.domain !== 'bot' || change.table !== 'bots') return
      const entity = ctx.bots.get(BotId(change.key))
      if (change.operation === 'deleted') {
        if (entity !== undefined) {
          fail(
            `Bot record '${change.key}' was deleted while the registry cache still `
            + 'publishes it — some write path bypassed ctx.bots',
          )
        }
        return
      }
      if (entity === undefined) {
        fail(
          `Bot record '${change.key}' landed durably but the registry cache holds `
          + 'no entity for it — the cache and the domain table have diverged',
        )
      }
    })
  },
  { inject: ['bots'] },
)

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
