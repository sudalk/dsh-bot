/**
 * Bot entity registry (`ctx.bots`): durable Bot records with an ordered
 * roster, profile validation, workspace-backed homes over the domain data
 * form, and the Bot's continuing conversation — created on first ask, adopted
 * durably, and identified by the Bot's own persona.
 * @module @deepseek-ai/dsh-bot
 */

import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
// Type-only: the optional permission service a Bot's pinned preset is written
// through. A deployment without it leaves every Bot on the deployment default.
import type {} from '@deepseek-ai/dsh-permission-presets'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { DomainGlobal, KvTable } from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-storage'
import type {} from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-workspace'
import { BotEntity } from './entity.ts'
import type { BotEntityHost } from './entity.ts'
import { installBotHandoffTool, renderHandoffFrame } from './handoff.ts'
import type { BotHandoffSource } from './handoff.ts'
import { installBotIdentity } from './identity.ts'
import { installBotPermission, restoreDefaultPermission } from './permission.ts'
import { renderConsultAnswerFrame, renderConsultFrame } from './consult.ts'
import type { BotConsultAnswerSource } from './consult.ts'
import { installBotConsultTool } from './consult.ts'
import { installBotRosterTool } from './roster.ts'
import type { BotTeammate } from './roster.ts'
import { botDomainSpec } from './spec.ts'
import type { BotDomainState, BotRecord } from './spec.ts'
import type {
  Bot, BotId as BotIdBrand, BotProfile, BotProfileUpdate, BotProfileValidation,
} from './types.ts'

export type {
  Bot, BotProfile, BotProfileUpdate, BotProfileValidation,
} from './types.ts'
export { botDomainSpec, botDomainState, botRecord } from './spec.ts'
export type { BotDomainState, BotRecord } from './spec.ts'
export { botPersona, installBotIdentity } from './identity.ts'
export { installBotPermission, restoreDefaultPermission } from './permission.ts'
export {
  BOT_CONSULT_ANSWER_MAX_CHARS, BOT_CONSULT_MAX_ROUNDS, BOT_CONSULT_QUESTION_MAX_CHARS,
  installBotConsultTool, renderConsultAnswerFrame, renderConsultFrame,
} from './consult.ts'
export type { BotConsultAnswerSource, BotConsultHost, BotConsultSource } from './consult.ts'
export {
  BOT_ROSTER_DESCRIPTION_MAX_CHARS, BOT_ROSTER_PERSONA_DESCRIPTION_MAX_CHARS,
  BOT_ROSTER_PERSONA_MAX_ENTRIES, installBotRosterTool, renderRosterPreamble,
} from './roster.ts'
export type { BotRosterHost, BotRosterValue, BotTeammate } from './roster.ts'
export {
  BOT_HANDOFF_MAX_DEPTH, BOT_HANDOFF_TASK_MAX_CHARS, installBotHandoffTool, renderHandoffFrame,
} from './handoff.ts'
export type { BotHandoffHost, BotHandoffSource } from './handoff.ts'

/** Identifies one Bot record (see `src/types.ts` for the brand rationale). */
export type BotId = BotIdBrand

/**
 * Brand a string as a {@link BotId}.
 * @param id - Raw Bot id string.
 * @returns the same string, branded at compile time.
 */
export function BotId(id: string): BotId {
  return id as BotId
}

/**
 * A create or update request carried a profile that fails validation. Nothing
 * was written; `reason` names the offending field by name.
 */
export class BotProfileInvalidError extends Error {
  /**
   * @param reason - Which field failed and why.
   */
  constructor(readonly reason: string) {
    super(`invalid Bot profile: ${reason}`)
    this.name = 'BotProfileInvalidError'
  }
}

/** A create request named a workspace the registry does not own. Nothing was written. */
export class BotUnknownWorkspaceError extends Error {
  /**
   * @param workspaceId - The unknown workspace id.
   */
  constructor(readonly workspaceId: string) {
    super(`cannot create Bot: no workspace '${workspaceId}' is registered`)
    this.name = 'BotUnknownWorkspaceError'
  }
}

/** A request named a Bot the registry does not hold. */
export class BotNotFoundError extends Error {
  /**
   * @param botId - The unknown Bot id.
   */
  constructor(readonly botId: BotId) {
    super(`no Bot '${botId}' is registered`)
    this.name = 'BotNotFoundError'
  }
}

/** Longest accepted Bot display name, so a roster row stays renderable. */
export const BOT_NAME_MAX_CHARS = 120

/** Longest accepted Bot role description; longer rules belong in a skill or team rule. */
export const BOT_DESCRIPTION_MAX_CHARS = 4_000

/**
 * Longest accepted avatar data URL. Uploads are downscaled in the browser
 * before they reach this boundary; the cap keeps one pathological image from
 * bloating the roster record every reader deserializes.
 */
export const BOT_AVATAR_MAX_CHARS = 400_000

/** Longest accepted permission preset name; presets are short keys, and the deployment resolves the value. */
export const BOT_PERMISSION_MAX_CHARS = 120

declare module '@deepseek-ai/cordis' {
  interface Context {
    bots: BotRegistry
  }
}

const sameIds = (left: readonly BotId[], right: readonly BotId[]): boolean =>
  left.length === right.length && left.every((id, index) => id === right[index])

/**
 * One consultation admitted to a teammate, awaiting the closing turn that
 * carries its answer. Reply capture reads the first turn the target opens
 * after admission, so a question queued behind unrelated work never mistakes
 * that work for its answer.
 */
interface PendingConsult {
  readonly questionId: string
  readonly round: number
  readonly question: string
  readonly askerId: BotId
  readonly askerName: string
  readonly answererId: BotId
  readonly answererName: string
  turn: number | undefined
  reply: string | undefined
}

/** Concatenate the text blocks of one assistant message. */
function assistantText(content: readonly ContentBlock[]): string {
  return content
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('')
}

/**
 * Validate a proposed Bot profile before any write. Message-independent so a
 * caller may preflight a form without touching durable state.
 * @param profile - Fields to validate; omission is checked by the caller.
 * @returns `{ ok: true }`, or `{ ok: false, reason }` naming the first failure.
 */
export function validateBotProfile(profile: Partial<BotProfile>): BotProfileValidation {
  if (profile.name !== undefined && profile.name.trim() === '') {
    return { ok: false, reason: 'name must not be blank' }
  }
  if (profile.name !== undefined && profile.name !== profile.name.trim()) {
    return { ok: false, reason: 'name must not have surrounding whitespace' }
  }
  if (profile.name !== undefined && profile.name.length > BOT_NAME_MAX_CHARS) {
    return { ok: false, reason: `name must be at most ${BOT_NAME_MAX_CHARS} characters` }
  }
  if (profile.description !== undefined && profile.description.trim() === '') {
    return { ok: false, reason: 'description must not be blank' }
  }
  if (profile.description !== undefined && profile.description !== profile.description.trim()) {
    return { ok: false, reason: 'description must not have surrounding whitespace' }
  }
  if (profile.description !== undefined && profile.description.length > BOT_DESCRIPTION_MAX_CHARS) {
    return { ok: false, reason: `description must be at most ${BOT_DESCRIPTION_MAX_CHARS} characters` }
  }
  if (profile.preset !== undefined && profile.preset.trim() === '') {
    return { ok: false, reason: 'preset must not be blank' }
  }
  if (profile.avatar !== undefined && profile.avatar !== ''
    && !profile.avatar.startsWith('data:image/')) {
    return { ok: false, reason: 'avatar must be a data:image/ URL' }
  }
  if (profile.avatar !== undefined && profile.avatar.length > BOT_AVATAR_MAX_CHARS) {
    return { ok: false, reason: `avatar must be at most ${BOT_AVATAR_MAX_CHARS} characters` }
  }
  // The empty string is the clearing form (see `BotProfile.permission`), so it
  // is accepted here; every other blank or padded candidate is refused.
  if (profile.permission !== undefined && profile.permission !== '') {
    if (profile.permission.trim() === '') {
      return { ok: false, reason: 'permission must not be blank' }
    }
    if (profile.permission !== profile.permission.trim()) {
      return { ok: false, reason: 'permission must not have surrounding whitespace' }
    }
    if (profile.permission.length > BOT_PERMISSION_MAX_CHARS) {
      return { ok: false, reason: `permission must be at most ${BOT_PERMISSION_MAX_CHARS} characters` }
    }
  }
  return { ok: true }
}

/**
 * Durable Bot registry. Startup waits for the storage domain, opens the Bot
 * domain, validates the stored roster order against the table, and rebuilds
 * the entity cache. The workspace registry is optional at load time so a
 * composition may read Bots before any workspace surface exists; a create
 * that needs to resolve a workspace fails loud when the registry is absent.
 * The registry also owns each Bot's continuing conversation and its identity:
 * a Session that is some Bot's conversation composes with that Bot's name and
 * role as its persona, installed on the Agent's own scope so the deployment
 * prompt is untouched for every other Session. That same Agent composition
 * carries the Bot's pinned permission preset to its Session, and the registry
 * routes a consultation question to a teammate and its answer back to the
 * asker.
 */
export class BotRegistry extends Service {
  static inject = ['storageDomain', 'agents', 'sessionController']

  private table?: KvTable<BotId, BotRecord>
  private global?: DomainGlobal<BotDomainState>
  private state?: BotDomainState
  private readonly entities = new Map<BotId, BotEntity>()
  private readonly opening = new Map<BotId, Promise<SessionId>>()
  private readonly identified = new WeakSet<Agent>()
  private readonly toolDisposers = new Map<Agent, ReadonlyArray<() => void>>()
  private readonly consultPending = new Map<string, PendingConsult>()
  private operationTail: Promise<void> = Promise.resolve()

  private readonly host: BotEntityHost = {
    table: () => this.requireTable(),
    ensureConversation: bot => this.openConversation(bot),
  }

  constructor(ctx: Context) {
    super(ctx, 'bots')
    ctx.on('agent/created', ({ agent }) => { this.identify(agent) })
    ctx.on('agent/disposed', ({ agent }) => {
      for (const dispose of this.toolDisposers.get(agent) ?? []) dispose()
      this.toolDisposers.delete(agent)
    })
    ctx.effect(() => {
      ctx.on('session/event', (session, event) => { this.observeConsult(session, event) })
      return () => { this.consultPending.clear() }
    }, 'bot.consultReply')
  }

  /**
   * Open the domain, validate the stored roster, and rebuild the entity
   * cache.
   */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(botDomainSpec)
    this.ctx.effect(() => () => domain.close(), 'bot.domainClose')
    this.table = domain.table('bots')
    this.global = domain.global
    this.state = domain.global.get()
    this.validateStoredState(this.state)
    this.rebuildEntities()
  }

  /**
   * Create one durable Bot. The name, description, and preset are validated
   * first; a supplied workspace must already be registered so the Bot never
   * points at a directory the product does not track, while an omitted
   * workspace leaves a pure chat Bot. A newly created Bot is prepended to
   * the durable roster order.
   * @param profile - Complete identity, rules, preset, and optional home workspace.
   * @returns the newly durable Bot.
   * @throws BotProfileInvalidError when a field fails validation.
   * @throws BotUnknownWorkspaceError when a named workspace is unregistered.
   */
  create(profile: BotProfile): Promise<Bot> {
    const validation = validateBotProfile(profile)
    if (!validation.ok) throw new BotProfileInvalidError(validation.reason)
    return this.enqueueOperation(async () => {
      if (profile.workspaceId !== undefined) {
        const workspaces = this.ctx.get('workspaceRegistry')
        if (workspaces?.get(profile.workspaceId) === undefined) {
          throw new BotUnknownWorkspaceError(String(profile.workspaceId))
        }
      }

      const id = BotId(randomUUID())
      const now = new Date().toISOString()
      const record: BotRecord = {
        name: profile.name,
        description: profile.description,
        preset: profile.preset,
        ...profile.avatar === undefined || profile.avatar === '' ? {} : { avatar: profile.avatar },
        ...profile.permission === undefined || profile.permission === '' ? {} : { permission: profile.permission },
        ...profile.workspaceId === undefined ? {} : { workspaceId: profile.workspaceId },
        createdAt: now,
        updatedAt: now,
      }
      const entity = new BotEntity(this.host, id, record)
      this.entities.set(id, entity)
      try {
        await this.requireTable().put(id, record)
      } catch (error) {
        this.entities.delete(id)
        throw error
      }
      const state = this.requireState()
      try {
        await this.setState({ ...state, botIds: [id, ...state.botIds] })
      } catch (error) {
        this.entities.delete(id)
        try {
          await this.requireTable().delete(id)
        } catch (rollbackError) {
          throw new AggregateError(
            [error, rollbackError],
            `Bot '${id}' order write and record rollback both failed`,
          )
        }
        throw error
      }
      return entity
    })
  }

  /**
   * Replace one Bot's mutable profile durably. Validation runs before any
   * write, and a repeated workspace change re-checks registration. A changed
   * permission reaches the Bot's live conversation immediately, so arming a
   * teammate takes effect without waiting for the next cold resume.
   * @param id - Bot to update.
   * @param update - Fields to replace; omitted fields keep their value.
   * @returns resolution after durability.
   * @throws BotNotFoundError when the id is unregistered.
   * @throws BotProfileInvalidError when a supplied field fails validation.
   * @throws BotUnknownWorkspaceError when a supplied workspace is unregistered.
   */
  update(id: BotId, update: BotProfileUpdate): Promise<void> {
    const validation = validateBotProfile(update)
    if (!validation.ok) throw new BotProfileInvalidError(validation.reason)
    return this.enqueueOperation(async () => {
      const entity = this.entities.get(id)
      if (entity === undefined) throw new BotNotFoundError(id)
      if (update.workspaceId !== undefined
        && this.ctx.get('workspaceRegistry')?.get(update.workspaceId) === undefined) {
        throw new BotUnknownWorkspaceError(String(update.workspaceId))
      }
      await entity.update(update)
      if (update.permission === undefined) return
      const conversationId = entity.conversationId
      if (conversationId === undefined) return
      const agent = this.ctx.agents.get(conversationId)
      if (agent === undefined) return
      // Clearing the pin returns the running conversation to the deployment
      // default; a bot without a pin has nothing to re-apply here.
      if (entity.permission === undefined) this.restorePermission(agent)
      else this.applyPermission(agent, entity)
    })
  }

  /**
   * Look up a Bot by id.
   * @param id - Bot id.
   * @returns the Bot, or `undefined` when unknown.
   */
  get(id: BotId): Bot | undefined {
    return this.entities.get(id)
  }

  /**
   * Find the Bot that owns one continuing conversation, for consumers that
   * see a Session and need to know which Bot it belongs to (the chat
   * identity is the first). The roster is small and this runs once per Agent
   * composition, so a scan is the whole implementation.
   * @param sessionId - Session identity to resolve.
   * @returns the owning Bot, or `undefined` when no Bot holds that conversation.
   */
  byConversation(sessionId: SessionId): Bot | undefined {
    for (const bot of this.entities.values()) {
      if (bot.conversationId === sessionId) return bot
    }
    return undefined
  }

  /**
   * Resolve one Bot by exact display name, in roster order so duplicates
   * resolve to the earliest entry. The roster is small, so a scan is the
   * whole implementation; the handoff tool resolves its target through this.
   * @param name - Display name as shown on the roster.
   * @returns the first Bot carrying that name, or `undefined`.
   */
  byName(name: string): Bot | undefined {
    const wanted = name.trim()
    for (const id of this.requireState().botIds) {
      const entity = this.entities.get(id)
      if (entity !== undefined && entity.name === wanted) return entity
    }
    return undefined
  }

  /**
   * Deliver one Bot's handoff into another Bot's conversation and wake it.
   * The target resumes the same durable conversation every other path uses,
   * so the user can open that chat and watch the work happen there.
   * @param from - Bot handing the task over.
   * @param target - Bot receiving the task.
   * @param task - Task text as the handing-off Bot wrote it.
   * @param depth - Depth of this hop on the handoff chain.
   * @returns resolution after the frame was admitted to the target's queue.
   */
  async deliverHandoff(from: Bot, target: Bot, task: string, depth: number): Promise<void> {
    const sessionId = await target.ensureConversation()
    const resolved = await this.ctx.sessionController.resolveAgent(sessionId)
    if ('error' in resolved) {
      throw new Error(`cannot wake "${target.name}": ${resolved.error.message}`)
    }
    const source: BotHandoffSource = {
      kind: 'bot-handoff',
      senderBotId: from.id,
      senderName: from.name,
      depth,
    }
    resolved.agent.followup(createUserMessage({
      content: [{ type: 'text', text: renderHandoffFrame({ fromName: from.name, task }) }],
      source,
    }))
  }

  /**
   * Synchronous roster projection in durable order (newest first).
   * @returns a fresh ordered array of Bot entities.
   */
  list(): Bot[] {
    return this.requireState().botIds.map((id) => {
      const entity = this.entities.get(id)
      if (entity === undefined) {
        throw new Error(`Bot registry order references missing Bot '${id}'`)
      }
      return entity
    })
  }

  /**
   * Delete one Bot record and its roster slot. Callers own the consequences
   * for work that references the Bot; this registry only removes its own
   * durable state. The table row is removed before its order entry so an
   * interrupted delete leaves an order entry that startup repair can drop.
   * @param id - Bot to remove.
   * @returns `true` when a record was deleted, `false` when it was unknown.
   */
  delete(id: BotId): Promise<boolean> {
    return this.enqueueOperation(async () => {
      const entity = this.entities.get(id)
      if (entity === undefined) return false
      // Remove the cache entry before the durable row so the invariant's
      // deleted-row observation never sees a row whose entity is still
      // published; restore it when the row write fails.
      this.entities.delete(id)
      try {
        await this.requireTable().delete(id)
      } catch (error) {
        this.entities.set(id, entity)
        throw error
      }
      const state = this.requireState()
      try {
        await this.setState({
          ...state,
          botIds: state.botIds.filter(botId => botId !== id),
        })
      } catch (error) {
        // The record is already gone; repair republishes the authoritative
        // order from the table on the next start, so the delete stands.
        this.ctx.logger.warn(
          `Bot '${id}' was deleted but its roster order could not be updated: ${String(error)}`,
        )
      }
      return true
    })
  }

  /**
   * Move one Bot within the durable roster order, DOM-insertBefore-like.
   * @param id - Bot to move.
   * @param beforeId - Bot anchor; omitted appends.
   * @returns the complete committed roster order.
   * @throws BotNotFoundError when either id is unregistered.
   */
  insertBefore(id: BotId, beforeId?: BotId): Promise<readonly BotId[]> {
    return this.enqueueOperation(async () => {
      const state = this.requireState()
      if (this.entities.get(id) === undefined) throw new BotNotFoundError(id)
      if (beforeId !== undefined && this.entities.get(beforeId) === undefined) {
        throw new BotNotFoundError(beforeId)
      }
      if (beforeId === id) return state.botIds
      const without = state.botIds.filter(botId => botId !== id)
      const at = beforeId === undefined ? without.length : without.indexOf(beforeId)
      const botIds = [...without.slice(0, at), id, ...without.slice(at)]
      if (sameIds(botIds, state.botIds)) return state.botIds
      await this.setState({ ...state, botIds })
      return botIds
    })
  }

  /**
   * Validate the stored roster against the table. Unexplained divergence
   * fails loud; an order entry whose record is missing is repaired only by
   * dropping the entry, and a record absent from the order is appended so no
   * Bot is silently lost.
   */
  private validateStoredState(state: BotDomainState): void {
    const table = this.requireTable()
    const seen = new Set<BotId>()
    for (const id of state.botIds) {
      if (seen.has(id)) {
        throw new Error(`Bot domain is inconsistent: roster order repeats Bot '${id}'`)
      }
      if (table.get(id) === undefined) {
        throw new Error(`Bot domain is inconsistent: roster order references missing Bot '${id}'`)
      }
      seen.add(id)
    }
    if (seen.size !== table.size) {
      const orphan = [...table.keys()].find(id => !seen.has(id))
      throw new Error(
        `Bot domain is inconsistent: Bot '${orphan as BotId}' is absent from roster order`,
      )
    }
  }

  private rebuildEntities(): void {
    this.entities.clear()
    for (const id of this.requireState().botIds) {
      const record = this.requireTable().get(id) as BotRecord
      this.entities.set(id, new BotEntity(this.host, id, record))
    }
  }

  /**
   * Resolve one Bot's continuing conversation with a single in-flight
   * creation per Bot. The Session belongs to the Bot's home workspace and
   * composes from the Bot's preset, so opening a Bot conversation resumes a
   * normal Session rather than inventing a parallel one.
   */
  private openConversation(bot: Bot): Promise<SessionId> {
    let opening = this.opening.get(bot.id)
    if (opening === undefined) {
      opening = this.openAdmitted(bot).finally(() => { this.opening.delete(bot.id) })
      this.opening.set(bot.id, opening)
    }
    return opening
  }

  private async openAdmitted(bot: Bot): Promise<SessionId> {
    const existing = bot.conversationId
    if (existing !== undefined) {
      this.repairIdentity(existing, bot)
      return existing
    }
    const created = await this.ctx.sessionController.create({
      // A pure chat Bot names no workspace: the Session composes from the
      // deployment's default directory instead of a tracked one.
      ...bot.workspaceId === undefined ? {} : { workspaceId: bot.workspaceId },
      agentPreset: bot.preset,
    })
    const sessionId = await bot.adoptConversation(created.sessionId)
    this.repairIdentity(sessionId, bot)
    return sessionId
  }

  /**
   * Identify the Session's Agent when one is already composed. A fresh
   * creation composes its first Agent inside `sessionController.create`,
   * before the Bot adopts the Session, so that Agent predates its own mapping
   * and never reaches the `agent/created` listener; repair it here instead.
   */
  private repairIdentity(sessionId: SessionId, bot: Bot): void {
    const agent = this.ctx.agents.get(sessionId)
    if (agent !== undefined) this.installIdentity(agent, bot)
  }

  /**
   * Give one newly composed Agent its Bot identity when its Session is that
   * Bot's continuing conversation. A cold resume composes a new Agent and
   * lands here again, so the identity survives restarts.
   */
  private identify(agent: Agent): void {
    const bot = this.byConversation(agent.id)
    if (bot !== undefined) this.installIdentity(agent, bot)
  }

  /**
   * Compose one Bot's identity into one live Agent's own scope: its persona
   * including the teammates it works beside, the handoff, roster, and
   * consultation tools that let it reach, inspect, and ask them, and its
   * pinned permission preset.
   */
  private installIdentity(agent: Agent, bot: Bot): void {
    if (this.identified.has(agent)) return
    const teammates = this.teammatesOf(bot)
    const persona = installBotIdentity(agent, bot, teammates)
    const disposers = [
      installBotHandoffTool(agent, this),
      installBotRosterTool(agent, this),
      installBotConsultTool(agent, this),
    ].filter((dispose): dispose is () => void => dispose !== undefined)
    if (disposers.length > 0) this.toolDisposers.set(agent, disposers)
    if (persona || disposers.length > 0) this.identified.add(agent)
    this.applyPermission(agent, bot)
  }

  /**
   * Deliver one consultation question into a teammate's conversation and arm
   * the reply capture. The captured answer is routed back to the asker as a
   * new message, so neither Bot holds a call open waiting on the other.
   * @param from - Bot asking the question.
   * @param target - Bot being consulted.
   * @param question - Question text as the asking Bot wrote it.
   * @param round - Round of this question within its chain.
   * @returns resolution after the question was admitted to the target's queue.
   */
  async deliverConsult(from: Bot, target: Bot, question: string, round: number): Promise<void> {
    const sessionId = await target.ensureConversation()
    const resolved = await this.ctx.sessionController.resolveAgent(sessionId)
    if ('error' in resolved) {
      throw new Error(`cannot consult "${target.name}": ${resolved.error.message}`)
    }
    const questionId = randomUUID()
    const pending: PendingConsult = {
      questionId,
      round,
      question,
      askerId: from.id,
      askerName: from.name,
      answererId: target.id,
      answererName: target.name,
      turn: undefined,
      reply: undefined,
    }
    this.consultPending.set(String(sessionId), pending)
    try {
      resolved.agent.followup(createUserMessage({
        content: [{ type: 'text', text: renderConsultFrame({ fromName: from.name, question }) }],
        source: {
          kind: 'bot-consult',
          senderBotId: from.id,
          senderName: from.name,
          questionId,
          round,
        },
      }))
    } catch (error) {
      this.consultPending.delete(String(sessionId))
      throw error
    }
  }

  /**
   * Observe one Session event for consultation reply capture. The first turn
   * the consulted Bot opens after admission is the one that answers the
   * question; that turn's closing reply is routed back to the asker.
   */
  private observeConsult(session: Session, event: SessionEvent): void {
    const pending = this.consultPending.get(String(session.id))
    if (pending === undefined) return
    switch (event.type) {
      case 'turn/start':
        if (pending.turn === undefined) pending.turn = event.data.turn
        return
      case 'assistant/message':
        if (pending.turn === event.data.turn) pending.reply = assistantText(event.data.message.content)
        return
      case 'turn/end': {
        if (pending.turn === undefined || pending.turn !== event.data.turn) return
        this.consultPending.delete(String(session.id))
        void this.settleConsult(pending).catch((error: unknown) => {
          this.ctx.logger.warn(`consultation reply handling failed: ${String(error)}`)
        })
        return
      }
      default:
        return
    }
  }

  /** Route one captured consultation answer back into the asker's conversation. */
  private async settleConsult(pending: PendingConsult): Promise<void> {
    const asker = this.entities.get(pending.askerId)
    if (asker === undefined) {
      this.ctx.logger.warn(`consultation from "${pending.askerName}" was dropped: that Bot is no longer on the roster`)
      return
    }
    const answerer = this.entities.get(pending.answererId)
    const answererName = answerer?.name ?? pending.answererName
    const reply = pending.reply?.trim()
    const sessionId = await asker.ensureConversation()
    const resolved = await this.ctx.sessionController.resolveAgent(sessionId)
    if ('error' in resolved) {
      this.ctx.logger.warn(`cannot return "${answererName}"'s answer to "${asker.name}": ${resolved.error.message}`)
      return
    }
    const source: BotConsultAnswerSource = {
      kind: 'bot-consult-answer',
      senderBotId: pending.answererId,
      senderName: answererName,
      questionId: pending.questionId,
      round: pending.round,
    }
    resolved.agent.followup(createUserMessage({
      content: [{
        type: 'text',
        text: renderConsultAnswerFrame({
          fromName: answererName,
          question: pending.question,
          answer: reply === undefined || reply === '' ? '（对方没有给出文字回复）' : reply,
        }),
      }],
      source,
    }))
  }

  /** Every other Bot on the roster, in roster order, as persona/roster entries. */
  private teammatesOf(bot: Bot): readonly BotTeammate[] {
    if (this.state === undefined) return []
    return this.list()
      .filter(other => other.id !== bot.id)
      .map(other => ({ name: other.name, description: other.description }))
  }

  /**
   * Display names of every Bot on the roster, in roster order. The handoff
   * tool's unknown-target diagnostic resolves its candidate list through this.
   * @returns roster names, or an empty list before the registry starts.
   */
  rosterNames(): readonly string[] {
    if (this.state === undefined) return []
    return this.list().map(bot => bot.name)
  }

  /**
   * Pin one live Agent's Session to its Bot's preset through the deployment's
   * permission service, which is optional here: a composition without it
   * leaves every Bot on the deployment default.
   */
  private applyPermission(agent: Agent, bot: Bot): void {
    installBotPermission(agent, bot, this.ctx.get('permissionPresets'), (message) => {
      this.ctx.logger.warn(message)
    })
  }

  /** Return one live Agent's Session to the deployment's default permission. */
  private restorePermission(agent: Agent): void {
    restoreDefaultPermission(agent, this.ctx.get('permissionPresets'), (message) => {
      this.ctx.logger.warn(message)
    })
  }

  private requireTable(): KvTable<BotId, BotRecord> {
    if (this.table === undefined) throw new Error('Bot registry is not started yet')
    return this.table
  }

  private requireState(): BotDomainState {
    if (this.state === undefined) throw new Error('Bot registry is not started yet')
    return this.state
  }

  private async setState(state: BotDomainState): Promise<void> {
    await (this.global as DomainGlobal<BotDomainState>).set(state)
    this.state = state
  }

  private enqueueOperation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationTail.then(operation)
    this.operationTail = result.then(() => {}, () => {})
    return result
  }
}

export default BotRegistry
