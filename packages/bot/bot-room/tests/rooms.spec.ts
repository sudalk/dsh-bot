import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import type { Bot } from '@deepseek-ai/dsh-bot'
import { BotId } from '@deepseek-ai/dsh-bot'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import BotRooms, {
  BotRoomInvalidError, BotRoomUnknownBotError,
  isRoomSkip, parseRoomMentions, renderRoomDeliveryFrame,
  ROOM_MEMBERS_MAX, ROOM_NAME_MAX_CHARS,
  RoomId, validateRoomMessage, validateRoomProfile,
} from '../src/index.ts'
import type { RoomMessageProfile, RoomProfile } from '../src/index.ts'

const BOT_A = BotId('bot-a')
const BOT_B = BotId('bot-b')
const BOT_C = BotId('bot-c')

const NAMES: Readonly<Record<string, string>> = {
  'bot-a': '测试助手',
  'bot-b': '代码审查员',
  'bot-c': '研究助手',
}

/** Boot the real storage/domain/room composition over one shared pool. */
async function harness(pool = new MemoryMediaPool()) {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  ctx.provide('bots', {
    get: (id: BotId) => (NAMES[String(id)] === undefined
      ? undefined
      : { id, name: NAMES[String(id)] } as unknown as Bot),
  } as never)
  // The router only touches the Session controller when a delivery actually
  // dispatches; these tests exercise the store and log, so the injected
  // service is a stub that would fail loud if it were reached.
  ctx.provide('sessionController', {
    create: async () => { throw new Error('room test: session creation is not part of these cases') },
    resolveAgent: async () => { throw new Error('room test: delivery dispatch is not part of these cases') },
  } as never)
  await ctx.plugin(BotRooms)
  return { ctx, rooms: ctx.botRooms, pool }
}

const profile = (overrides: Partial<RoomProfile> = {}): RoomProfile => ({
  name: '代码审查员、研究助手',
  memberIds: [BOT_A, BOT_B],
  ...overrides,
})

const message = (roomId: RoomId, overrides: Partial<RoomMessageProfile> = {}): RoomMessageProfile => ({
  roomId,
  senderKind: 'user',
  senderName: '用户',
  text: '大家好，今天看一下登录模块。',
  mentions: [],
  ...overrides,
})

describe('validateRoomProfile', () => {
  it('accepts a complete profile and an empty partial update', () => {
    expect(validateRoomProfile(profile())).toEqual({ ok: true })
    expect(validateRoomProfile({})).toEqual({ ok: true })
  })

  it('rejects padded, blank, and over-long names', () => {
    expect(validateRoomProfile({ name: ' Team' })).toEqual({
      ok: false,
      reason: 'name must not have surrounding whitespace',
    })
    expect(validateRoomProfile({ name: '  ' })).toEqual({
      ok: false,
      reason: 'name must not be blank',
    })
    expect(validateRoomProfile({ name: 'a'.repeat(ROOM_NAME_MAX_CHARS + 1) })).toEqual({
      ok: false,
      reason: `name must be at most ${ROOM_NAME_MAX_CHARS} characters`,
    })
  })

  it('bounds the member roster to a group chat', () => {
    expect(validateRoomProfile({ memberIds: [BOT_A] })).toEqual({
      ok: false,
      reason: 'memberIds must name at least 2 Bots',
    })
    const tooMany = Array.from({ length: ROOM_MEMBERS_MAX + 1 }, (_, index) => BotId(`bot-${index}`))
    expect(validateRoomProfile({ memberIds: tooMany })).toEqual({
      ok: false,
      reason: `memberIds must name at most ${ROOM_MEMBERS_MAX} Bots`,
    })
    expect(validateRoomProfile({ memberIds: [BOT_A, BOT_A] })).toEqual({
      ok: false,
      reason: 'memberIds must not repeat a Bot',
    })
  })
})

describe('validateRoomMessage', () => {
  it('rejects blank and over-long bodies', () => {
    expect(validateRoomMessage({ text: '   ' })).toEqual({ ok: false, reason: 'text must not be blank' })
    expect(validateRoomMessage({ text: 'a'.repeat(8_001) })).toEqual({
      ok: false,
      reason: 'text must be at most 8000 characters',
    })
  })

  it('requires a sender for Bot messages only', () => {
    expect(validateRoomMessage({ senderKind: 'bot' })).toEqual({
      ok: false,
      reason: 'senderId must name the authoring Bot',
    })
    expect(validateRoomMessage({ senderKind: 'user', senderId: BOT_A })).toEqual({
      ok: false,
      reason: 'senderId is only valid for a Bot author',
    })
    expect(validateRoomMessage({ senderKind: 'bot', senderId: BOT_A })).toEqual({ ok: true })
  })
})

describe('BotRooms', () => {
  it('creates rooms, lists them newest first, and reads them back by id', async () => {
    const { rooms } = await harness()
    const first = await rooms.create(profile())
    const second = await rooms.create(profile({ name: '调研小队', memberIds: [BOT_A, BOT_C] }))

    expect(rooms.list().map(entry => entry.name)).toEqual(['调研小队', first.name])
    expect(rooms.get(first.id)?.memberIds).toEqual([BOT_A, BOT_B])
    expect(rooms.get(second.id)?.memberIds).toEqual([BOT_A, BOT_C])
    expect(first.createdAt).toBe(first.updatedAt)
    expect(RoomId(String(first.id))).toBe(first.id)
  })

  it('refuses an unknown Bot and an invalid profile before touching durable state', async () => {
    const { rooms } = await harness()
    await expect(rooms.create(profile({ memberIds: [BOT_A, BotId('bot-ghost')] })))
      .rejects.toBeInstanceOf(BotRoomUnknownBotError)
    await expect(rooms.create(profile({ name: ' ' }))).rejects.toBeInstanceOf(BotRoomInvalidError)
    expect(rooms.list()).toEqual([])
  })

  it('renames a room without touching its members or its log', async () => {
    const { rooms } = await harness()
    const room = await rooms.create(profile())
    await rooms.appendMessage(message(room.id))

    const renamed = await rooms.rename(room.id, '新名字')
    expect(renamed.name).toBe('新名字')
    expect(renamed.memberIds).toEqual(room.memberIds)
    expect(rooms.messages(room.id)).toHaveLength(1)
    // Renaming to the name it already carries is a no-op, not a write.
    expect(await rooms.rename(room.id, '新名字')).toEqual(renamed)
    await expect(rooms.rename(room.id, ' ')).rejects.toBeInstanceOf(BotRoomInvalidError)
    await expect(rooms.rename(RoomId('missing'), 'x')).rejects.toThrow(/is registered/)
  })

  it('appends messages, reads the newest window, and counts them', async () => {
    const { rooms } = await harness()
    const room = await rooms.create(profile())
    await rooms.appendMessage(message(room.id, { text: '第一条' }))
    await rooms.appendMessage(message(room.id, {
      senderKind: 'bot',
      senderId: BOT_B,
      senderName: '代码审查员',
      text: '收到，我先看登录态。',
      mentions: [BOT_A],
    }))
    await rooms.appendMessage(message(room.id, { text: '第三条' }))

    const all = rooms.messages(room.id)
    expect(all.map(entry => entry.text)).toEqual(['第一条', '收到，我先看登录态。', '第三条'])
    expect(all[1]?.senderKind).toBe('bot')
    expect(all[1]?.mentions).toEqual([BOT_A])
    expect(rooms.messages(room.id, 2).map(entry => entry.text)).toEqual(['收到，我先看登录态。', '第三条'])
    expect(rooms.messageCount(room.id)).toBe(3)
  })

  it('refuses to append to an unknown room', async () => {
    const { rooms } = await harness()
    const room = await rooms.create(profile())
    await rooms.delete(room.id)
    await expect(rooms.appendMessage(message(room.id))).rejects.toThrow(/is registered/)
  })

  it('edits membership within bounds', async () => {
    const { rooms } = await harness()
    const room = await rooms.create(profile())
    const added = await rooms.addMember(room.id, BOT_C)
    expect(added.memberIds).toEqual([BOT_A, BOT_B, BOT_C])
    await expect(rooms.addMember(room.id, BOT_C)).rejects.toBeInstanceOf(BotRoomInvalidError)
    await expect(rooms.addMember(room.id, BotId('bot-ghost'))).rejects.toBeInstanceOf(BotRoomUnknownBotError)

    const removed = await rooms.removeMember(room.id, BOT_C)
    expect(removed.memberIds).toEqual([BOT_A, BOT_B])
    await expect(rooms.removeMember(room.id, BOT_C)).rejects.toBeInstanceOf(BotRoomInvalidError)
    // At the floor of two members any further removal is refused.
    await expect(rooms.removeMember(room.id, BOT_B)).rejects.toBeInstanceOf(BotRoomInvalidError)
  })

  it('deletes a room together with its log and publishes each change', async () => {
    const { rooms } = await harness()
    const changes: string[] = []
    rooms.subscribe(change => changes.push(change.kind))
    const room = await rooms.create(profile())
    await rooms.appendMessage(message(room.id))

    expect(await rooms.delete(room.id)).toBe(true)
    expect(rooms.get(room.id)).toBeUndefined()
    expect(rooms.messages(room.id)).toEqual([])
    expect(await rooms.delete(room.id)).toBe(false)
    expect(changes).toEqual(['room-upsert', 'message', 'room-remove'])
  })

  it('rebuilds rooms and their logs from durable state on restart', async () => {
    const pool = new MemoryMediaPool()
    const first = await harness(pool)
    const room = await first.rooms.create(profile({ name: 'Persisted room' }))
    await first.rooms.appendMessage(message(room.id, { text: '持久化的消息' }))

    const second = await harness(pool)
    expect(second.rooms.list().map(entry => entry.name)).toEqual(['Persisted room'])
    expect(second.rooms.messages(room.id).map(entry => entry.text)).toEqual(['持久化的消息'])
  })

  it('resolves members against the live roster with an id fallback', async () => {
    const { rooms } = await harness()
    const room = await rooms.create(profile())
    expect(rooms.describeMembers(room)).toEqual([
      { botId: BOT_A, name: '测试助手' },
      { botId: BOT_B, name: '代码审查员' },
    ])
  })
})

describe('parseRoomMentions', () => {
  const members = [
    { botId: BOT_A, name: '测试助手' },
    { botId: BOT_B, name: '代码审查员' },
    { botId: BOT_C, name: '测试' },
  ]

  it('resolves the longest member name at each @', () => {
    const result = parseRoomMentions('请 @测试助手 和 @测试 各自看一下', members)
    expect(result.botIds).toEqual([BOT_A, BOT_C])
    expect(result.everyone).toBe(false)
  })

  it('deduplicates repeated mentions in first-mention order', () => {
    const result = parseRoomMentions('@代码审查员 先看，再请 @测试助手 复核，最后 @代码审查员 汇总', members)
    expect(result.botIds).toEqual([BOT_B, BOT_A])
  })

  it('recognizes every everyone alias', () => {
    for (const alias of ['@everyone', '@所有人', '@全体成员']) {
      expect(parseRoomMentions(`${alias} 都看一下`, members).everyone).toBe(true)
    }
    expect(parseRoomMentions('没有提到任何人', members)).toEqual({ botIds: [], everyone: false })
  })

  it('ignores an @ that matches no member name', () => {
    expect(parseRoomMentions('@不存在的人 看一下', members).botIds).toEqual([])
  })
})

describe('room delivery framing', () => {
  it('recognizes the skip token at any leading whitespace', () => {
    expect(isRoomSkip('[skip]')).toBe(true)
    expect(isRoomSkip('  [Skip] 这次不参与')).toBe(true)
    expect(isRoomSkip('我来说两句')).toBe(false)
  })

  it('frames the room, members, recent log, and the new message within the bound', () => {
    const frame = renderRoomDeliveryFrame({
      roomName: '代码审查员、研究助手',
      members: [{ name: '测试助手' }, { name: '代码审查员' }],
      recent: [
        { senderName: '用户', text: '大家好' },
        { senderName: '测试助手', text: '我先看登录态' },
      ],
      senderName: '用户',
      text: '请审查这段改动',
    })
    expect(frame).toContain('群聊「代码审查员、研究助手」')
    expect(frame).toContain('成员：测试助手、代码审查员')
    expect(frame).toContain('最近的群聊消息')
    expect(frame).toContain('以下是「用户」刚发进群里的话')
    expect(frame).toContain('请审查这段改动')
    expect(frame).toContain('[skip]')
    expect(frame.length).toBeLessThanOrEqual(4_000)
  })

  it('truncates a long message rather than exceeding the frame budget', () => {
    const frame = renderRoomDeliveryFrame({
      roomName: '长消息测试',
      members: [{ name: '测试助手' }, { name: '代码审查员' }],
      recent: [],
      senderName: '用户',
      text: 'x'.repeat(10_000),
    })
    expect(frame.length).toBeLessThanOrEqual(4_000)
    expect(frame).toContain('…')
  })
})
