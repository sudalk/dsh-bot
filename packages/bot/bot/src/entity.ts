/**
 * Package-private Bot entity: the single {@link Bot} implementation. Holds a
 * record snapshot swapped in place after each durable mutation, so every
 * write funnels through the private `mutate` that stamps `updatedAt` exactly
 * once. Not re-exported from the package entrypoint — consumers see only the
 * `Bot` interface.
 * @module @deepseek-ai/dsh-bot/src/entity
 */

import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { BotProfileUpdate, Bot, BotId } from './types.ts'
import type { BotRecord } from './spec.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** The registry-owned machinery an entity mutates through. */
export interface BotEntityHost {
  /**
   * Resolve the open `bots` table.
   * @returns the table; throws while the registry has not started yet.
   */
  table(): KvTable<BotId, BotRecord>

  /**
   * Resolve (creating on first ask) this Bot's continuing conversation and
   * install the Bot's identity on its Agent.
   * @param bot - The entity whose conversation is needed.
   * @returns the durable conversation Session id.
   */
  ensureConversation(bot: Bot): Promise<SessionId>
}

/** Chain-slot abort sentinel thrown by the update fn when the record needs no change; only `mutate` observes it. */
const unchangedSentinel = new Error('bot record unchanged (internal sentinel)')

/** The single {@link Bot} implementation; constructed only by the registry. */
export class BotEntity implements Bot {
  private record: BotRecord

  /**
   * @param host - Registry-owned table access.
   * @param id - The record's stable id.
   * @param record - The validated record snapshot loaded or just written.
   */
  constructor(
    private readonly host: BotEntityHost,
    readonly id: BotId,
    record: BotRecord,
  ) {
    this.record = record
  }

  get name(): string {
    return this.record.name
  }

  get description(): string {
    return this.record.description
  }

  get preset(): string {
    return this.record.preset
  }

  get avatar(): string | undefined {
    return this.record.avatar
  }

  get permission(): string | undefined {
    return this.record.permission
  }

  get workspaceId(): BotRecord['workspaceId'] {
    return this.record.workspaceId
  }

  get conversationId(): SessionId | undefined {
    return this.record.conversationId
  }

  get createdAt(): string {
    return this.record.createdAt
  }

  get updatedAt(): string {
    return this.record.updatedAt
  }

  async update(update: BotProfileUpdate): Promise<void> {
    await this.mutate((record) => {
      const next: BotRecord = {
        ...record,
        ...update.name === undefined ? {} : { name: update.name },
        ...update.description === undefined ? {} : { description: update.description },
        ...update.preset === undefined ? {} : { preset: update.preset },
        ...update.workspaceId === undefined ? {} : { workspaceId: update.workspaceId },
        // The empty string is the clearing form: the key is removed rather
        // than written, so an avatar-less record never carries a value.
        ...update.avatar === undefined ? {}
          : update.avatar === '' ? { avatar: undefined } : { avatar: update.avatar },
        // Same clearing form: the empty string returns the Bot to the
        // deployment's default permission instead of pinning a preset.
        ...update.permission === undefined ? {}
          : update.permission === '' ? { permission: undefined } : { permission: update.permission },
      }
      return next
    })
  }

  /**
   * Adopt the one continuing conversation this Bot will resume. The first
   * open wins: a transform that finds an adopted conversation returns the
   * record verbatim, so a racing open aborts its slot instead of replacing
   * the winner's Session.
   * @param sessionId - Session created for this Bot.
   * @returns the conversation id the record holds after the call.
   */
  async adoptConversation(sessionId: SessionId): Promise<SessionId> {
    if (this.record.conversationId !== undefined) return this.record.conversationId
    await this.mutate(record => (
      record.conversationId === undefined ? { ...record, conversationId: sessionId } : record
    ))
    // Read back through the getter: the mutated snapshot is not the value the
    // pre-await narrowing describes.
    return this.conversationId ?? sessionId
  }

  /**
   * Resolve this Bot's continuing conversation through the registry, which
   * owns creation, adoption, the single-in-flight guard, and identity
   * installation.
   * @returns the durable conversation Session id.
   */
  async ensureConversation(): Promise<SessionId> {
    return await this.host.ensureConversation(this)
  }

  /**
   * The single write path: run the transform on the domain write chain via
   * `table.update`, stamping `updatedAt`, then swap the snapshot. A transform
   * that returns the current record verbatim aborts the slot through the
   * sentinel, so a no-op neither rewrites the medium nor emits a change event.
   */
  private async mutate(fn: (record: BotRecord) => BotRecord): Promise<void> {
    let next: BotRecord
    try {
      next = await this.host.table().update(this.id, (current) => {
        const changed = fn(current)
        if (changed.name === current.name
          && changed.description === current.description
          && changed.preset === current.preset
          && changed.workspaceId === current.workspaceId
          && changed.avatar === current.avatar
          && changed.permission === current.permission
          && changed.conversationId === current.conversationId) {
          throw unchangedSentinel
        }
        return { ...changed, updatedAt: new Date().toISOString() }
      })
    } catch (error) {
      if (error === unchangedSentinel) return
      throw error
    }
    this.record = next
  }
}
