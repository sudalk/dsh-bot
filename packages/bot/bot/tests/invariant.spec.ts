import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import type { DomainChanged } from '@deepseek-ai/dsh-storage-domain'
import * as BotInvariant from '../src/invariant.ts'
import { BotId } from '../src/index.ts'

/** Boot the invariant service plus the companion over a stubbed registry knowing exactly `ids`. */
async function setup(ids: string[]): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(InvariantRegistry)
  ctx.provide('bots', {
    get: (id: BotId) => (ids.includes(String(id)) ? { id } : undefined),
  })
  await ctx.plugin(BotInvariant)
  return ctx
}

type ChangeLocation = Partial<Pick<DomainChanged, 'domain' | 'table' | 'key'>>

const put = (overrides?: ChangeLocation): DomainChanged => ({
  domain: 'bot',
  table: 'bots',
  key: 'b1',
  operation: 'put',
  value: {},
  ...overrides,
})

const deleted = (): DomainChanged => ({
  domain: 'bot',
  table: 'bots',
  key: 'b1',
  operation: 'deleted',
})

describe('Bot cache/table invariant', () => {
  it('accepts a put whose record has a cached entity and ignores foreign events', async () => {
    const ctx = await setup(['b1'])
    expect(() => { ctx.emit('domain/changed', put()) }).not.toThrow()
    // Other domains and other tables are out of scope, whatever their shape.
    expect(() => { ctx.emit('domain/changed', put({ domain: 'other', key: 'missing' })) }).not.toThrow()
    expect(() => { ctx.emit('domain/changed', put({ table: 'other', key: 'missing' })) }).not.toThrow()
  })

  it('fails a put whose record has no cached entity', async () => {
    const ctx = await setup([])
    expect(() => { ctx.emit('domain/changed', put()) })
      .toThrow(/cache and the domain table have diverged/)
  })

  it('fails a deletion while the registry still publishes the entity', async () => {
    const ctx = await setup(['b1'])
    expect(() => { ctx.emit('domain/changed', deleted()) })
      .toThrow(/cache still publishes/)
  })

  it('accepts a deletion once the registry has dropped the entity', async () => {
    const ctx = await setup([])
    expect(() => { ctx.emit('domain/changed', deleted()) }).not.toThrow()
  })
})
