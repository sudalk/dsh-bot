import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import type { DomainChanged } from '@deepseek-ai/dsh-storage-domain'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import BotRegistry, {
  BOT_DESCRIPTION_MAX_CHARS,
  BOT_NAME_MAX_CHARS,
  BOT_PERMISSION_MAX_CHARS,
  BotId,
  BotNotFoundError,
  BotProfileInvalidError,
  BotUnknownWorkspaceError,
  validateBotProfile,
} from '../src/index.ts'
import { botDomainSpec } from '../src/spec.ts'
import type { BotProfile } from '../src/index.ts'

const HOME = WorkspaceId('ws-home')

/** Boot only the storage side so a caller can control what the registry sees. */
async function storageContext(pool: MemoryMediaPool, agents: unknown = { get: () => undefined }) {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  // The registry injects the Agent and Session services for its conversation
  // machinery. The roster cases never open a conversation, so these stubs
  // would fail loud if one did; conversation coverage lives with the room
  // router and the end-to-end runs.
  ctx.provide('agents', agents as never)
  ctx.provide('sessionController', {
    create: async () => { throw new Error('bot test: conversation opening is not part of these cases') },
  } as never)
  return ctx
}

/** Boot the real storage/domain/registry composition with `registered` workspace ids. */
async function harness(
  registered: readonly string[] = [String(HOME)],
  pool = new MemoryMediaPool(),
) {
  const ctx = await storageContext(pool)
  ctx.provide('workspaceRegistry', {
    get: (id: WorkspaceId) => (registered.includes(String(id)) ? { id } : undefined),
  } as never)
  await ctx.plugin(BotRegistry)
  const registry = ctx.bots
  return { ctx, registry, pool }
}

const profile = (overrides: Partial<BotProfile> = {}): BotProfile => ({
  name: 'Researcher',
  description: 'Gather sources and cite every claim.',
  preset: 'default',
  workspaceId: HOME,
  ...overrides,
})

/**
 * Inject a failure into the pool's Nth subsequent write primitive. The
 * memory backend calls `consumeInjectedFailure` once per putRecord,
 * deleteRecord, and setGlobal, so this counts primitives, not operations.
 */
function failNthWrite(pool: MemoryMediaPool, nth: number, message: string): void {
  let writes = 0
  const original = pool.consumeInjectedFailure.bind(pool)
  pool.consumeInjectedFailure = () => {
    writes += 1
    if (writes === nth) throw new Error(message)
    original()
  }
}

describe('validateBotProfile', () => {
  it('accepts a complete profile and an empty partial update', () => {
    expect(validateBotProfile(profile())).toEqual({ ok: true })
    expect(validateBotProfile({})).toEqual({ ok: true })
  })

  it('rejects padded, blank, and over-long names', () => {
    expect(validateBotProfile({ name: ' Researcher' })).toEqual({
      ok: false,
      reason: 'name must not have surrounding whitespace',
    })
    expect(validateBotProfile({ name: '   ' })).toEqual({
      ok: false,
      reason: 'name must not be blank',
    })
    expect(validateBotProfile({ name: 'a'.repeat(BOT_NAME_MAX_CHARS + 1) })).toEqual({
      ok: false,
      reason: `name must be at most ${BOT_NAME_MAX_CHARS} characters`,
    })
  })

  it('rejects padded, blank, and over-long descriptions', () => {
    expect(validateBotProfile({ description: 'rules ' })).toEqual({
      ok: false,
      reason: 'description must not have surrounding whitespace',
    })
    expect(validateBotProfile({ description: ' ' })).toEqual({
      ok: false,
      reason: 'description must not be blank',
    })
    expect(validateBotProfile({ description: 'a'.repeat(BOT_DESCRIPTION_MAX_CHARS + 1) })).toEqual({
      ok: false,
      reason: `description must be at most ${BOT_DESCRIPTION_MAX_CHARS} characters`,
    })
  })

  it('rejects a blank preset', () => {
    expect(validateBotProfile({ preset: ' ' })).toEqual({
      ok: false,
      reason: 'preset must not be blank',
    })
  })

  it('accepts the clearing permission and rejects blank, padded, and over-long ones', () => {
    // The empty string is the documented clearing form, not a blank value.
    expect(validateBotProfile({ permission: '' })).toEqual({ ok: true })
    expect(validateBotProfile({ permission: 'danger-full-access' })).toEqual({ ok: true })
    expect(validateBotProfile({ permission: ' ' })).toEqual({
      ok: false,
      reason: 'permission must not be blank',
    })
    expect(validateBotProfile({ permission: ' danger-full-access' })).toEqual({
      ok: false,
      reason: 'permission must not have surrounding whitespace',
    })
    expect(validateBotProfile({ permission: 'a'.repeat(BOT_PERMISSION_MAX_CHARS + 1) })).toEqual({
      ok: false,
      reason: `permission must be at most ${BOT_PERMISSION_MAX_CHARS} characters`,
    })
  })
})

describe('BotRegistry', () => {
  it('creates a Bot, lists it newest first, and exposes its profile', async () => {
    const { registry } = await harness()
    const first = await registry.create(profile())
    const second = await registry.create(profile({ name: 'Writer' }))

    expect(registry.list().map(bot => bot.name)).toEqual(['Writer', 'Researcher'])
    expect(registry.get(first.id)?.description).toBe('Gather sources and cite every claim.')
    expect(second.workspaceId).toBe(HOME)
    expect(second.createdAt).toBe(second.updatedAt)
    expect(BotId(String(second.id))).toBe(second.id)
  })

  it('refuses a profile that fails validation before touching durable state', async () => {
    const { registry } = await harness()
    expect(() => registry.create(profile({ name: '' })))
      .toThrow(BotProfileInvalidError)
    expect(registry.list()).toEqual([])
  })

  it('refuses a workspace the registry does not own', async () => {
    const { registry } = await harness([])
    await expect(registry.create(profile())).rejects.toBeInstanceOf(BotUnknownWorkspaceError)
    expect(registry.list()).toEqual([])
  })

  it('updates mutable fields, stamps updatedAt, and leaves a no-op unwritten', async () => {
    const { registry } = await harness()
    const bot = await registry.create(profile())
    const before = bot.updatedAt

    await new Promise(resolve => setTimeout(resolve, 2))
    await registry.update(bot.id, { name: 'Scout', description: 'Own the weekly review.' })
    expect(bot.name).toBe('Scout')
    expect(bot.description).toBe('Own the weekly review.')
    expect(bot.updatedAt).not.toBe(before)

    const settled = bot.updatedAt
    await registry.update(bot.id, { name: 'Scout' })
    expect(bot.updatedAt).toBe(settled)
  })

  it('validates an update before writing and rejects an unknown Bot or workspace', async () => {
    const { registry } = await harness()
    const bot = await registry.create(profile())

    expect(() => registry.update(bot.id, { preset: '' })).toThrow(BotProfileInvalidError)
    await expect(registry.update(BotId('missing'), { name: 'x' })).rejects.toBeInstanceOf(BotNotFoundError)
    await expect(registry.update(bot.id, { workspaceId: WorkspaceId('ws-other') }))
      .rejects.toBeInstanceOf(BotUnknownWorkspaceError)
    expect(bot.name).toBe('Researcher')
  })

  it('deletes a Bot idempotently and removes its roster slot', async () => {
    const { registry } = await harness()
    const bot = await registry.create(profile())

    expect(await registry.delete(bot.id)).toBe(true)
    expect(registry.list()).toEqual([])
    expect(registry.get(bot.id)).toBeUndefined()
    expect(await registry.delete(bot.id)).toBe(false)
  })

  it('reorders the roster insertBefore-style', async () => {
    const { registry } = await harness()
    const a = await registry.create(profile({ name: 'A' }))
    const b = await registry.create(profile({ name: 'B' }))
    const c = await registry.create(profile({ name: 'C' }))

    expect(registry.list().map(bot => bot.name)).toEqual(['C', 'B', 'A'])
    expect(await registry.insertBefore(a.id, c.id)).toEqual([a.id, c.id, b.id])
    expect(await registry.insertBefore(a.id)).toEqual([c.id, b.id, a.id])
    expect(await registry.insertBefore(a.id, a.id)).toEqual([c.id, b.id, a.id])
    // A no-op move (the source already sits at its target position) returns
    // the committed order without writing.
    expect(await registry.insertBefore(b.id, a.id)).toEqual([c.id, b.id, a.id])
    await expect(registry.insertBefore(BotId('missing'))).rejects.toBeInstanceOf(BotNotFoundError)
    await expect(registry.insertBefore(a.id, BotId('missing'))).rejects.toBeInstanceOf(BotNotFoundError)
  })

  it('rebuilds its cache from durable state on restart', async () => {
    const pool = new MemoryMediaPool()
    const first = (await harness([String(HOME)], pool)).registry
    const bot = await first.create(profile({ name: 'Persisted' }))

    const second = (await harness([String(HOME)], pool)).registry
    expect(second.list().map(entry => entry.name)).toEqual(['Persisted'])
    expect(second.get(bot.id)?.preset).toBe('default')
  })

  it('fails loud on a roster entry whose record is missing', async () => {
    const pool = new MemoryMediaPool()
    const { ctx, registry } = await harness([String(HOME)], pool)
    const bot = await registry.create(profile())
    // Corrupt the medium directly: drop the record while leaving the roster
    // order entry in place, exactly like an interrupted write.
    const medium = pool.media.get(botDomainSpec.name) as {
      tables: Map<string, Map<string, unknown>>
    }
    medium.tables.get('bots')?.delete(String(bot.id))
    await ctx.fiber.dispose()

    const revivedCtx = await storageContext(pool)
    revivedCtx.provide('workspaceRegistry', { get: () => ({ id: HOME }) } as never)
    await expect(revivedCtx.plugin(BotRegistry)).rejects.toThrow(/references missing Bot/)
  })

  it('surfaces a storage write failure and leaves the roster unchanged', async () => {
    const pool = new MemoryMediaPool()
    const ctx = await storageContext(pool)
    ctx.provide('workspaceRegistry', { get: () => ({ id: HOME }) } as never)
    await ctx.plugin(BotRegistry)
    const registry = ctx.bots
    failNthWrite(pool, 1, 'medium down')
    await expect(registry.create(profile())).rejects.toThrow('medium down')
    expect(registry.list()).toEqual([])

    const bot = await registry.create(profile())
    failNthWrite(pool, 1, 'delete down')
    await expect(registry.delete(bot.id)).rejects.toThrow('delete down')
    expect(registry.get(bot.id)).toBeDefined()
  })

  it('keeps the record when the roster-order write fails during create', async () => {
    const pool = new MemoryMediaPool()
    const ctx = await storageContext(pool)
    ctx.provide('workspaceRegistry', { get: () => ({ id: HOME }) } as never)
    await ctx.plugin(BotRegistry)
    const registry = ctx.bots
    // The record write lands first, then the roster-order global write fails;
    // the registry must roll the record back.
    failNthWrite(pool, 2, 'order down')
    await expect(registry.create(profile())).rejects.toThrow('order down')
    expect(registry.list()).toEqual([])
  })

  it('warns but keeps a deletion when the roster-order write fails', async () => {
    const pool = new MemoryMediaPool()
    const ctx = await storageContext(pool)
    ctx.provide('workspaceRegistry', { get: () => ({ id: HOME }) } as never)
    await ctx.plugin(BotRegistry)
    const registry = ctx.bots
    const bot = await registry.create(profile())
    const warn = vi.spyOn(ctx.logger, 'warn')
    // The record delete lands first, then the roster-order global write fails.
    failNthWrite(pool, 2, 'order down')
    await expect(registry.delete(bot.id)).resolves.toBe(true)
    expect(registry.get(bot.id)).toBeUndefined()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('roster order could not be updated'))
  })

  it('notifies domain observers on every durable write', async () => {
    const { ctx, registry } = await harness()
    const changes: DomainChanged[] = []
    ctx.on('domain/changed', change => changes.push(change))
    const bot = await registry.create(profile())
    await registry.update(bot.id, { name: 'Scout' })
    await registry.delete(bot.id)
    expect(changes.map(change => change.operation))
      .toEqual(['put', 'put', 'put', 'deleted', 'put'])
  })

  it('surfaces an update write failure without changing the snapshot', async () => {
    const pool = new MemoryMediaPool()
    const ctx = await storageContext(pool)
    ctx.provide('workspaceRegistry', { get: () => ({ id: HOME }) } as never)
    await ctx.plugin(BotRegistry)
    const bot = await ctx.bots.create(profile())
    failNthWrite(pool, 1, 'update down')
    await expect(ctx.bots.update(bot.id, { name: 'Scout' })).rejects.toThrow('update down')
    expect(bot.name).toBe('Researcher')
  })

  it('reports both failures when a create rollback cannot delete the record', async () => {
    const pool = new MemoryMediaPool()
    const ctx = await storageContext(pool)
    ctx.provide('workspaceRegistry', { get: () => ({ id: HOME }) } as never)
    await ctx.plugin(BotRegistry)
    // Record write lands, order write fails, rollback delete fails.
    failNthWrite(pool, 2, 'order down')
    let writes = 0
    const injected = pool.consumeInjectedFailure.bind(pool)
    pool.consumeInjectedFailure = () => {
      writes += 1
      if (writes === 3) throw new Error('rollback down')
      injected()
    }
    await expect(ctx.bots.create(profile())).rejects.toBeInstanceOf(AggregateError)
  })

  it('fails loud on a repeated roster entry and on an unlisted record', async () => {
    const duplicate = craftedPool(
      [['b1', 'Bot One']],
      { botIds: ['b1', 'b1'] },
    )
    await expect(bootInto(duplicate)).rejects.toThrow(/roster order repeats Bot/)

    const orphan = craftedPool(
      [['b1', 'Bot One'], ['b2', 'Bot Two']],
      { botIds: ['b1'] },
    )
    await expect(bootInto(orphan)).rejects.toThrow(/absent from roster order/)
  })

  it('fails loud when the roster names a record the cache cannot hold', async () => {
    const pool = new MemoryMediaPool()
    const { registry } = await harness([String(HOME)], pool)
    const bot = await registry.create(profile())
    // Prove the projection guard: drop the entity while the durable order
    // still names it, which only a bypassing writer could produce.
    registry['entities'].delete(bot.id)
    expect(() => registry.list()).toThrow(/references missing Bot/)
  })

  it('updates each mutable field independently and accepts a workspace move', async () => {
    const { registry } = await harness([String(HOME), 'ws-other'])
    const bot = await registry.create(profile())

    await registry.update(bot.id, { description: 'New rules.' })
    expect(bot.description).toBe('New rules.')
    expect(bot.name).toBe('Researcher')

    await registry.update(bot.id, { preset: 'planner' })
    expect(bot.preset).toBe('planner')

    await registry.update(bot.id, { workspaceId: WorkspaceId('ws-other') })
    expect(String(bot.workspaceId)).toBe('ws-other')

    await registry.update(bot.id, { name: 'Scout' })
    expect(bot.name).toBe('Scout')
  })

  it('rejects registry access before startup completes', async () => {
    const ctx = new Context()
    ctx.provide('workspaceRegistry', { get: () => ({ id: HOME }) } as never)
    const registry = new BotRegistry(ctx)
    expect(() => registry.list()).toThrow(/not started yet/)
    await expect(registry.create(profile())).rejects.toThrow(/not started yet/)
  })
})

/**
 * The permission pin is applied through the deployment's service, so these
 * cases drive a recording stand-in and a live-Agent stub whose Session is the
 * object the pin must land on.
 */
describe('Bot permission', () => {
  const agent = { session: { id: 's-1' } }

  /** Recording permission stand-in; `names` decides what the deployment offers. */
  const service = (
    applied: Array<{ session: unknown; name: string }>,
    names: readonly string[] = ['workspace-write', 'danger-full-access'],
  ) => ({
    names,
    defaultPreset: 'workspace-write',
    set: (session: unknown, name: string) => { applied.push({ session, name }) },
  })

  /** Harness over a live conversation: `agents.get` answers with the stub Agent. */
  async function permissionHarness(presets: unknown, pool = new MemoryMediaPool()) {
    const ctx = await storageContext(pool, { get: () => agent })
    ctx.provide('workspaceRegistry', { get: (id: WorkspaceId) => ({ id }) } as never)
    if (presets !== undefined) ctx.provide('permissionPresets', presets as never)
    await ctx.plugin(BotRegistry)
    return { ctx, registry: ctx.bots }
  }

  it('keeps the pin durable and re-applies it to the live conversation', async () => {
    const applied: Array<{ session: unknown; name: string }> = []
    const { registry } = await permissionHarness(service(applied))
    const bot = await registry.create(profile({ permission: 'danger-full-access' }))

    expect(bot.permission).toBe('danger-full-access')
    await bot.adoptConversation('s-1' as SessionId)
    await registry.update(bot.id, { permission: 'danger-full-access' })

    expect(applied).toEqual([{ session: agent.session, name: 'danger-full-access' }])
  })

  it('keeps the pin across a restart', async () => {
    const pool = new MemoryMediaPool()
    const applied: Array<{ session: unknown; name: string }> = []
    const first = await permissionHarness(service(applied), pool)
    const bot = await first.registry.create(profile({ permission: 'danger-full-access' }))

    const { registry } = await permissionHarness(service(applied), pool)
    expect(registry.get(bot.id)?.permission).toBe('danger-full-access')
  })

  it('returns the live conversation to the deployment default when the pin is cleared', async () => {
    const applied: Array<{ session: unknown; name: string }> = []
    const { registry } = await permissionHarness(service(applied))
    const bot = await registry.create(profile({ permission: 'danger-full-access' }))
    await bot.adoptConversation('s-1' as SessionId)

    await registry.update(bot.id, { permission: '' })

    expect(bot.permission).toBeUndefined()
    expect(applied).toEqual([{ session: agent.session, name: 'workspace-write' }])
  })

  it('degrades to the deployment default on an unoffered or unserviceable pin', async () => {
    const applied: Array<{ session: unknown; name: string }> = []
    const { ctx, registry } = await permissionHarness(service(applied, ['workspace-write']))
    const bot = await registry.create(profile({ permission: 'danger-full-access' }))
    await bot.adoptConversation('s-1' as SessionId)
    const warn = vi.spyOn(ctx.logger, 'warn')

    await registry.update(bot.id, { permission: 'ghost' })

    expect(applied).toEqual([])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('does not offer'))

    // A composition without the permission plugin keeps the pin recorded and
    // reports nothing: the deployment simply has no presets to apply.
    const bare = await permissionHarness(undefined)
    const bareBot = await bare.registry.create(profile({ permission: 'danger-full-access' }))
    await bareBot.adoptConversation('s-1' as SessionId)
    const bareWarn = vi.spyOn(bare.ctx.logger, 'warn')
    await expect(bare.registry.update(bareBot.id, { permission: 'danger-full-access' }))
      .resolves.toBeUndefined()
    expect(bareWarn).toHaveBeenCalledWith(expect.stringContaining('composes no permission presets'))
  })
})

/** Pool whose `bot` unit already holds `entries` records and `state` as its global. */
function craftedPool(
  entries: Array<[string, string]>,
  state: { botIds: string[] },
): MemoryMediaPool {
  const pool = new MemoryMediaPool()
  pool.versions.set('bot', 1)
  pool.media.set('bot', {
    tables: new Map([['bots', new Map(entries.map(([id, name]) => [id, {
      name,
      description: 'rules',
      preset: 'default',
      workspaceId: String(HOME),
      createdAt: '2026-10-03T00:00:00.000Z',
      updatedAt: '2026-10-03T00:00:00.000Z',
    }]))]]),
    global: state,
  })
  return pool
}

/** Boot the registry over an already-populated pool and return the boot promise. */
async function bootInto(pool: MemoryMediaPool): Promise<void> {
  const ctx = await storageContext(pool)
  ctx.provide('workspaceRegistry', { get: () => ({ id: HOME }) } as never)
  await ctx.plugin(BotRegistry)
}
