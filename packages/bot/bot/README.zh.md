---
description: "Bot 实体注册表（ctx.bots）：为宿主提供可挂载、调试的持久命名 AI 队友，携带 preset、workspace 主目录与名册顺序。"
kind: "package-reference"
---

# @deepseek-ai/dsh-bot

[English](README.md) | 中文

## Summary

用这个包维护一份持久的命名 AI 队友名册。一个 Bot 携带塑造其每一段对话的画像——显示名称、承载规则的描述、其 Session 组合所用的 agent preset、作为主目录的 workspace，以及可选的固定权限——外加一个可手动排序的名册位置。它是既有会话模型之上的身份层：与 Bot 的对话就是普通 Session，本包只拥有决定该 Session 如何组合的持久记录。需要在产品中展示队友名册时使用它；它只属于 Host，需要 storage 相关行，并在创建指向产品未持有的 workspace 时显式失败。

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

用这个包为产品提供队友名册：比任何单次对话活得更久的命名 Bot，保留固定的职责描述，并且始终用同一个 preset 和 workspace 组合。

### When to use it

当产品需要持久队友界面、且对话必须继承持久身份时使用。若每段对话都是匿名的，则不必挂载；harness 的其他部分不依赖它。

### Setting up

该包需要保存其记录的 storage 相关行。最小组合：

```yaml
- name: '@deepseek-ai/dsh-storage'
- name: '@deepseek-ai/dsh-storage-json'
- name: '@deepseek-ai/dsh-storage-domain'
  config:
    backend: json
- name: '@deepseek-ai/dsh-bot'
```

注册表在启动时打开自己的 domain，并校验存储的名册顺序。若组合中还挂载了 `@deepseek-ai/dsh-workspace`，创建 Bot 时可以指定 workspace；未挂载时每次创建都会显式失败，而不是指向产品并不追踪的目录。

### Creating and updating Bots

创建 Bot 会在任何写入之前校验整个画像，然后持久化记录并把其 id 前插到持久名册顺序中：

```text
// Host consumer code, after the composition above is loaded:
const bot = await ctx.bots.create({
  name: 'Researcher',
  description: 'Gather sources, cite every claim, and never contact anyone without approval.',
  preset: 'default',
  workspaceId,
})
await ctx.bots.update(bot.id, { description: 'New standing rules.' })
ctx.bots.list() // the roster, newest first
```

名称与描述会被去除首尾空白、不可为空白，并且有长度上限（`BOT_NAME_MAX_CHARS`、`BOT_DESCRIPTION_MAX_CHARS`）。`validateBotProfile` 暴露同一套校验，供表单在不写入的前提下预检。

### Pinning a conversation's permission

Bot 可以固定它每段对话所运行的权限预设：用户为某个队友放开的完全文件访问、且不再弹出审批，会在重启之后依然生效，而不会悄悄退回部署默认值。这个固定写在记录上就是一个预设名，应用到每个为该 Bot 组合出的 Agent 的 Session，并在画像变更时立即重新应用；用空字符串清除后，正在运行的对话会立刻回到部署默认权限。

该固定经由部署的权限服务生效：若组合中没有 `@deepseek-ai/dsh-permission-presets`，固定仍会记录、而按部署默认值执行；部署不提供的预设名会被报告出来，而不是让组合失败。

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

`BotRegistry`（`ctx.bots`）拥有持久记录、名册顺序与实体缓存。`BotEntity` 是 `Bot` 接口背后的包内私有实现；所有变更都经过同一条写入路径并盖上 `updatedAt`，空操作既不会重写介质，也不会发出变更事件。

domain spec（`botDomainSpec`）声明一张以 `BotId` 为键的 `bots` 表，以及保存 `botIds` 的 global。spec 对象是 domain 身份、版本与记录 schema 的唯一来源。记录在持久化边界由 zod 校验；消费者永远不直接接触 backend。

启动时会用表校验存储的名册并显式报告不可解释的不一致：重复的顺序项、顺序项对应的记录缺失、或记录不在顺序中，都会拒绝打开，而不是静默修复一个不可能的状态。创建先写记录再写顺序项，并在顺序写入失败时回滚记录。

可选的 invariant 伴随包（`@deepseek-ai/dsh-bot/invariant`）双向断言注册表缓存与 `bots` 表之间的归属关系。

Source: [`packages/bot/bot/src/index.ts`](./src/index.ts)

-----

<a id="further-exploration"></a>
## Further Exploration

- [`@deepseek-ai/dsh-workspace`](../../workspace/workspace/README.zh.md) 拥有可以作为 Bot 主目录的目录。
- [`@deepseek-ai/dsh-storage-domain`](../../storage/storage-domain/README.zh.md) 拥有本注册表打开的 domain 数据形态。
- [`@deepseek-ai/dsh-preset`](../../preset/agent-preset/README.zh.md) 拥有 Bot 所指定的 preset。

-----

<a id="model-experience"></a>
## Model Experience

### Bot 身份与任务交接

#### 模型看到什么

为某个 Bot 的持续会话组合出的 Agent 会携带该 Bot 的 persona——它的名字与固定职责，安装在该 Agent 自己的作用域上，因此只遮蔽该 Session 的部署 persona——外加一段有界的队友名册（列出其他 Bot 及其职责），以及三个工具：`handoff_to_bot` 把一个有界任务投进另一个 Bot 的会话并在那里唤醒它；`list_bots` 按需给出同一份名册的、更完整的描述；`ask_teammate` 向队友提一个问题，并把捕获到的回答作为新消息回传给提问者、唤醒其继续。其他 Session 保持部署 prompt，什么都不会获得。

#### Token 影响

persona 文本、名册块与三个工具的 schema 位于该 Bot 会话每一轮请求的前缀中。名册块最多携带 12 位队友、每人描述截断到 200 字符；`list_bots` 返回全部队友、每人描述截断到 500 字符。单次交接任务上限 8,000 字符；一条交接链最多跨越 3 次交接，之后工具会拒绝，并告知接收方自行完成剩余工作。单次咨询的问题上限 4,000 字符、捕获的回答上限 8,000 字符；一条咨询链最多 3 轮，之后提问方必须自行继续。

#### KV Cache 影响

组合 Bot 会话会相对普通 Session 改变请求前缀，而在该会话内部前缀保持稳定。交接投递以普通用户消息追加在前缀之后，不会使已有条目失效。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Bot 记录不拥有其对话。把 Bot 与其 preset、workspace 创建的 Session 关联起来，并把画像暴露给模型，是消费者的职责，本注册表有意不承担。
- 删除 Bot 只移除它自己的记录与名册位置。级联到例程、房间或正在运行的工作尚未实现；在这些领域出现之前，由调用方承担后果。
- 记忆、技能选择与 MCP 连接器选择暂不属于记录。画像目前只携带身份层当下需要的字段。
- 名册顺序是单一扁平列表。置顶、分组与按用户排序尚未建模。

-----

<a id="dev-note"></a>
### Dev Note

domain spec 位于 `src/spec.ts`，是声明持久格式的唯一位置。记录变更需要自己的持久化确认；见 [docs/cookbook/reviewing-persistence-type-changes.md](../../../docs/cookbook/reviewing-persistence-type-changes.zh.md)。
