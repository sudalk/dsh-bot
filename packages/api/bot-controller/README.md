---
description: "Bot Remote commands and reconnect-safe state transport for browser clients of the DeepSeek Harness."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-bot-controller

English | [中文](README.zh.md)

## Summary

Use this package to expose the Bot roster and its rooms to browser clients. It is the Host half of the generated `ctx.remote.bot` namespace: explicit commands for every roster and room change, a roster stream, a room stream, and the one room-post entry point whose deliveries reach member conversations. Every mutation returns the complete authoritative row, and every stream opens with a full baseline before increments, so a client that reconnects rebuilds its state without diffing. Choose it when a browser surface needs Bot or room state; Host-only, it needs the Bot registry, room store, and a Session controller.

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

Use this package when a browser client shows the Bot roster or its group chats. It owns the `bot` Remote namespace; the browser generates its typed client from the same descriptors, so this README describes the verb surface rather than the transport.

### When to use it

Use it whenever a browser surface needs Bot or room state. Skip it for Host-only compositions; nothing else in the harness needs it.

### Setting up

```yaml
- name: '@deepseek-ai/dsh-bot'
- name: '@deepseek-ai/dsh-bot-room'
- name: '@deepseek-ai/dsh-api-bot-controller'
```

The browser half rides the generated Remote artifact: the client assembly in `@deepseek-ai/dsh-api-remotes` imports `@deepseek-ai/dsh-api-bot-controller/remote` and mounts it, so a client build must follow every descriptor change.

### The verb surface

| Group | Verbs | Notes |
|---|---|---|
| Roster | `create`, `update`, `delete`, `insertBefore`, `ensureConversation` | Each mutation returns the authoritative Bot row; `ensureConversation` opens the Bot's continuing chat on first ask. |
| Rooms | `roomsList`, `roomsGet`, `roomsCreate`, `roomsRename`, `roomsDelete`, `roomsAddMember`, `roomsRemoveMember` | Room views carry the current members and the message count. |
| Messages | `roomsMessages`, `roomsPost` | `roomsMessages` reads at most the newest N entries; `roomsPost` appends the message and delivers it to the addressed members. |
| Streams | `follow`, `roomsFollow` | Each opens with a `baseline` frame and then increments: roster `upsert`/`remove`, room `room-upsert`/`room-remove`/`message`/`activity`. |

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer details — click to expand</summary>

`BotController` is a `TypertRemoteService` registered as `ctx.botController` under the `bot` namespace. Mutations funnel into `ctx.bots` and `ctx.botRooms`; the projection helpers (`botView`, `roomProjection`, `roomMessageView`) are the only wire shapes. Roster increments come from the storage domain's `domain/changed` stream, room increments from the room store's subscriptions, and working-state frames from its activity feed; `FrameFollower` is the single-generation queue behind every stream. No runtime invariant companion is published because this service owns no independently observed state beyond the projections it derives on demand.

</details>

Source: [`packages/api/bot-controller/src/index.ts`](./src/index.ts)

-----

<a id="further-exploration"></a>
## Further Exploration

- [`@deepseek-ai/dsh-bot`](../../bot/bot/README.md) — the roster and each Bot's continuing conversation.
- [`@deepseek-ai/dsh-bot-room`](../../bot/bot-room/README.md) — the group-chat store and its delivery engine.
- [`@deepseek-ai/dsh-api-remotes`](../remotes/README.md) — the client assembly that mounts this namespace.

-----

<a id="model-experience"></a>
## Model Experience

None, as this package only projects the Bot roster and rooms to browser consumers, while `dsh-bot` and `dsh-bot-room` own every model-visible contribution.

#### KV Cache effect

None; the package never assembles or sends provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Process-local streams** — followers live in memory: a Host restart drops every open stream, and each client must reconnect and rebuild from the fresh baseline.
- **Newest-N message reads** — `roomsMessages` returns at most the newest N entries and carries no paging cursor, so older room history is not reachable through this namespace.
- **Fixed user authorship** — `roomsPost` records every browser post under the fixed user identity; per-caller identities are not modeled yet.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer details — click to expand</summary>

The namespace is generated from the Host method descriptors: adding or changing a verb means rebuilding the Host face so the `remote` artifact and the client descriptors regenerate before any consumer rebuilds.

</details>
