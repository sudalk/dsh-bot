---
description: "Durable rooms (ctx.botRooms) for hosts choosing, mounting, or debugging first-class group chats whose message log is routed into each member Bot's own conversation."
kind: "package-reference"
---

# @deepseek-ai/dsh-bot-room

English | [中文](README.zh.md)

## Summary

Use this package to give the product first-class group chats. A Room is a durable roster of two to six Bots plus its own append-only message log; it is not a Session, so the transcript never hides inside one conversation. Posting parses `@member` mentions, appends the message, then routes a framed delivery into each addressed Bot's own conversation; replies return under each Bot's identity and their mentions become handoffs, all bounded per root message. Choose it when the product shows group chats over the Bot roster; it is Host-only and fails loud on an unknown room or member.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Use this package when a product needs group chats whose members are durable Bots with their own memories, rather than one shared agent session.

### When to use it

Use it when the product shows a group-chat surface over a Bot roster. Skip it when conversations are anonymous or one-to-one only; nothing else in the harness needs it.

### Setting up

The package needs the storage rows, the Bot registry, and a Session controller that can resume a Session on demand. A minimal composition:

```yaml
- name: '@deepseek-ai/dsh-storage'
- name: '@deepseek-ai/dsh-storage-json'
- name: '@deepseek-ai/dsh-storage-domain'
  config:
    backend: json
- name: '@deepseek-ai/dsh-session-controller'
- name: '@deepseek-ai/dsh-bot'
- name: '@deepseek-ai/dsh-bot-room'
```

The registry opens its domain and rebuilds both caches at startup; rooms recorded before a restart come back with their full message logs.

### Running a room

Creating a room validates the whole profile — a name plus two to six registered Bots — before any write. Posting a message is the product-level entry point:

```text
// Host consumer code, after the composition above is loaded:
const room = await ctx.botRooms.create({ name: '代码审查员、测试助手', memberIds: [reviewer.id, tester.id] })
await ctx.botRooms.post(room.id, '请一起看一下登录模块的这两个问题', { kind: 'user', senderName: '用户' })
```

The post appends the message first, then delivers one framed user message into each addressed member's own conversation. Replies appear in the room log asynchronously as each Bot's turn closes; `subscribe` reports every committed change and `subscribeActivity` reports which members currently have a delivery in flight.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Each delivery carries the room message id as its durable de-duplication key in the target Session's `room-message` source, so a replay is detectable. Deliveries are serialized per Bot: at most one admitted delivery waits for its closing turn, and reply capture reads the first turn the target opens after admission, so a message queued behind unrelated work never mistakes that work for its answer.

### Source map

| File | Role |
|---|---|
| [`src/spec.ts`](src/spec.ts) | The `bot_room` domain: `rooms` and `messages` tables with their durable schemas |
| [`src/rooms.ts`](src/rooms.ts) | `BotRoomStore`: validated room records, the append-only log, and membership edits |
| [`src/mentions.ts`](src/mentions.ts) | `@member` resolution: longest-name matching and the everyone aliases |
| [`src/frame.ts`](src/frame.ts) | Delivery framing: the bounded text one target Bot reads, and the skip token |
| [`src/delivery.ts`](src/delivery.ts) | `BotRoomDelivery`: audience resolution, per-Bot queues, reply capture, handoffs, and the diffusion budget |
| [`src/index.ts`](src/index.ts) | `BotRooms` service (`ctx.botRooms`): domain ownership, change publication, and the router entry points |
| — | No invariant companion is published: the service owns no independently observed state beyond the domain tables that the storage gate already validates. |
| [`tests/rooms.spec.ts`](tests/rooms.spec.ts) | Store, log, membership, mention, and framing coverage |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [`@deepseek-ai/dsh-bot`](../bot/README.md) — the Bot roster whose conversations receive room deliveries.
- [`@deepseek-ai/dsh-api-bot-controller`](../../api/bot-controller/README.md) — the Remote namespace exposing rooms to the browser.

-----

<a id="model-experience"></a>
## Model Experience

### Room message delivery

#### What the model sees

A room reaches a model only through its members: each delivery is one framed user message in the target Bot's own Session carrying the room name, the current member list, the newest log lines, and the delivered text. A reply whose first non-whitespace token is `[skip]` stays out of the room log, so a member with nothing to add does not re-enter other members' contexts.

#### Token effect

Each frame is bounded at 4,000 characters and folds in at most the newest 10 log lines, each truncated to 280 characters; the full room log never enters a request. One root message admits at most 8 deliveries across its targets and handoffs, and a handoff chain is bounded at 4 hops.

#### KV Cache effect

The frame appends after the target Session's stable prefix, so a delivery does not invalidate existing provider-cache entries.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **In-memory delivery state** — queues and pending replies are process-local; a crash between appending a message and admitting its deliveries loses those deliveries, while the message itself stays in the log.
- **One conversation per Bot** — every room and direct chat share the Bot's single Session, so its context interleaves.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
