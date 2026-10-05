---
description: "面向浏览器客户端的 Bot Remote 命令与可重连状态传输。"
kind: "package-reference"
---

# @deepseek-ai/dsh-api-bot-controller

[English](README.md) | 中文

## Summary

用这个包把 Bot 名册及其房间暴露给浏览器客户端。它是生成的 `ctx.remote.bot` 命名空间的宿主侧：覆盖每一次名册与房间变更的显式命令、一条名册流、一条房间流，以及唯一的房间投递入口——其投递会抵达成员会话。每个变更都返回完整的权威行，每条流都先发一份完整 baseline 再发增量，因此重连的客户端无需做 diff 即可重建状态。浏览器界面需要 Bot 或房间状态时选它；它只跑在宿主侧，需要 Bot 注册表、房间存储和一个 Session 控制器。

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

当浏览器客户端展示 Bot 名册或其群聊时用这个包。它拥有 `bot` Remote 命名空间；浏览器从同一份描述符生成类型化客户端，因此本文描述的是动词面，而不是传输细节。

### When to use it

任何浏览器界面需要 Bot 或房间状态时都可以用它。只需宿主侧的组合则跳过；框架中其他部分都不需要它。

### Setting up

```yaml
- name: '@deepseek-ai/dsh-bot'
- name: '@deepseek-ai/dsh-bot-room'
- name: '@deepseek-ai/dsh-api-bot-controller'
```

浏览器半边依赖生成的 Remote 产物：`@deepseek-ai/dsh-api-remotes` 中的客户端装配会导入并挂载 `@deepseek-ai/dsh-api-bot-controller/remote`，因此每次描述符变更之后都要重新构建客户端。

### The verb surface

| 分组 | 动词 | 说明 |
|---|---|---|
| 名册 | `create`、`update`、`delete`、`insertBefore`、`ensureConversation` | 每个变更都返回权威 Bot 行；`ensureConversation` 在首次请求时打开该 Bot 的持续会话。 |
| 房间 | `roomsList`、`roomsGet`、`roomsCreate`、`roomsRename`、`roomsDelete`、`roomsAddMember`、`roomsRemoveMember` | 房间视图携带当前成员与消息数量。 |
| 消息 | `roomsMessages`、`roomsPost` | `roomsMessages` 最多读取最新的 N 条；`roomsPost` 追加消息并投递给被点名的成员。 |
| 流 | `follow`、`roomsFollow` | 每条流先发 `baseline` 帧，随后是增量：名册 `upsert`/`remove`，房间 `room-upsert`/`room-remove`/`message`/`activity`。 |

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer details — click to expand</summary>

`BotController` 是以 `bot` 命名空间注册为 `ctx.botController` 的 `TypertRemoteService`。所有变更汇入 `ctx.bots` 与 `ctx.botRooms`；投影辅助函数（`botView`、`roomProjection`、`roomMessageView`）是唯一的线上形态。名册增量来自存储域的 `domain/changed` 流，房间增量来自房间存储自身的订阅，工作状态帧来自它的活动流；`FrameFollower` 是每条流背后的单代队列。本包不发布运行时 invariant 伴随包：除按需派生出的投影之外，本服务没有独立可观测的状态。

</details>

Source: [`packages/api/bot-controller/src/index.ts`](./src/index.ts)

-----

<a id="further-exploration"></a>
## Further Exploration

- [`@deepseek-ai/dsh-bot`](../../bot/bot/README.zh.md) —— 名册与每个 Bot 的持续会话。
- [`@deepseek-ai/dsh-bot-room`](../../bot/bot-room/README.zh.md) —— 群聊存储与其投递引擎。
- [`@deepseek-ai/dsh-api-remotes`](../remotes/README.zh.md) —— 挂载该命名空间的客户端装配。

-----

<a id="model-experience"></a>
## Model Experience

无：本包只把 Bot 名册与房间投影给浏览器消费者；一切对模型可见的贡献都由 `dsh-bot` 与 `dsh-bot-room` 拥有。

#### KV Cache 影响

无；本包从不组装或发送 provider 请求。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **流是进程本地的** —— 跟随者只存在于内存中：宿主重启会断开所有已打开的流，每个客户端都必须重连并从新的 baseline 重建。
- **消息读取为最新 N 条** —— `roomsMessages` 最多返回最新的 N 条且没有分页游标，更早的房间历史无法通过该命名空间获取。
- **固定的用户署名** —— `roomsPost` 以固定的用户身份记录每一条浏览器投递；按调用方区分身份的能力尚未建模。

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer details — click to expand</summary>

该命名空间由宿主方法描述符生成：新增或修改动词都需要先重建宿主面，让 `remote` 产物与客户端描述符重新生成，再构建任何消费方。

</details>
