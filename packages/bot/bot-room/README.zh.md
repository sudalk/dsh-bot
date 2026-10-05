---
description: "面向宿主的持久房间（ctx.botRooms）：一等公民的群聊，消息日志会路由进每个成员 Bot 自己的会话。"
kind: "package-reference"
---

# @deepseek-ai/dsh-bot-room

[English](README.md) | 中文

## Summary

用这个包为产品提供一等公民的群聊。一个 Room 是两到六个 Bot 的持久名册，外加它自己只追加的消息日志；它不是 Session，所以对话记录不会藏在某一条会话里。发消息时会解析 `@成员` 提及、追加消息，并把一条带框的投递送进每个被点名 Bot 自己的持续会话；回复以各 Bot 的身份回到日志，其中的提及成为交接，每条根消息的扩散有次数预算。当产品要在 Bot 名册之上展示群聊时选它；它只跑在宿主侧，并在房间或成员 Bot 不存在时大声失败。

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

当产品需要「成员是有自己记忆的持久 Bot」的群聊，而不是一条共享的 agent 会话时，用这个包。

### When to use it

当产品在 Bot 名册之上展示群聊界面时使用。若会话是匿名的、或只有单聊，则跳过；框架中其他部分都不需要它。

### Setting up

这个包需要存储行、Bot 注册表，以及一个能按需恢复会话的 Session 控制器。一个最小组合：

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

注册表在启动时打开自己的域并重建两份缓存；重启前记录的房间会带着完整消息日志回来。

### Running a room

创建房间会在任何写入之前校验整个资料——一个名字加两到六个已注册的 Bot。发消息是产品级入口：

```text
// Host consumer code, after the composition above is loaded:
const room = await ctx.botRooms.create({ name: '代码审查员、测试助手', memberIds: [reviewer.id, tester.id] })
await ctx.botRooms.post(room.id, '请一起看一下登录模块的这两个问题', { kind: 'user', senderName: '用户' })
```

post 先追加消息，再把一条带框的用户消息投进每个被点名成员自己的会话。回复会在各个 Bot 回合结束时异步出现在房间日志里；`subscribe` 上报每一次落盘变更，`subscribeActivity` 上报当前哪些成员有投递在飞。

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

每条投递都会把房间消息 id 作为目标会话 `room-message` 来源里的持久去重键，因此重放是可检测的。投递按 Bot 串行：最多一条已受理的投递在等待它的收尾回合，回复捕获只读取目标在受理之后打开的第一个回合，所以排在无关工作后面的消息不会把那段工作误当成自己的回答。

### Source map

| File | Role |
|---|---|
| [`src/spec.ts`](src/spec.ts) | `bot_room` 域：`rooms` 与 `messages` 两张表和它们的持久 schema |
| [`src/rooms.ts`](src/rooms.ts) | `BotRoomStore`：校验过的房间记录、只追加日志、成员编辑 |
| [`src/mentions.ts`](src/mentions.ts) | `@成员` 解析：最长名字匹配与 `@everyone` 别名 |
| [`src/frame.ts`](src/frame.ts) | 投递带框：目标 Bot 读到的那段有界文本，以及跳过标记 |
| [`src/delivery.ts`](src/delivery.ts) | `BotRoomDelivery`：受众解析、按 Bot 队列、回复捕获、交接与扩散预算 |
| [`src/index.ts`](src/index.ts) | `BotRooms` 服务（`ctx.botRooms`）：域归属、变更发布与路由入口 |
| — | 不发布 invariant 伴随包：除存储门禁已经校验的域表之外，本服务没有独立可观测的状态。 |
| [`tests/rooms.spec.ts`](tests/rooms.spec.ts) | 存储、日志、成员、提及与组框的覆盖 |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [`@deepseek-ai/dsh-bot`](../bot/README.zh.md) —— Bot 名册，房间投递的接收方。
- [`@deepseek-ai/dsh-api-bot-controller`](../../api/bot-controller/README.zh.md) —— 把房间暴露给浏览器的 Remote 命名空间。

-----

<a id="model-experience"></a>
## Model Experience

### 房间消息投递

#### 模型看到什么

房间只通过成员触达模型：每条投递就是目标 Bot 自己会话里的一条带框用户消息，携带房间名、当前成员列表、最近日志行与被投递的文本。首 token 为 `[skip]` 的回复不会进入房间日志，因此没有话可说的成员不会再次进入其他成员的上下文。

#### Token 影响

每条投递帧有 4,000 字符上限，最多纳入最近 10 条日志行、每行截断到 280 字符；完整房间日志不会进入请求。一条根消息最多产生 8 次投递（跨全部目标与交接），交接链上限 4 层。

#### KV Cache 影响

投递帧追加在目标会话稳定的前缀之后，因此投递不会使已有的 provider 缓存条目失效。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **投递状态在内存里** —— 队列与待回复是进程本地的；在「追加消息」与「受理投递」之间崩溃会丢掉那批投递，而消息本身仍在日志里。
- **一个 Bot 一条会话** —— 所有房间与单聊共享该 Bot 的唯一 Session，上下文会互相交错。

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
