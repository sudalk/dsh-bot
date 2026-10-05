---
description: "面向 Web 客户端的 Bots 面板：名册页与创建流程。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-bot

[English](README.md) | 中文

## Summary

用这个包为 Web 客户端提供 Bots 面板：会话侧栏、带创建表单的名册、每个 Bot 一条持续会话、群聊面板，以及可编辑 Bot 名称、职责、头像与固定权限的信息抽屉。Bot 聊天就是在面板内渲染的普通 Session：其资源解析宿主的持续会话，名册同时把这些 Session 发布到 session-visibility 面前，让 Workspace 浏览器将它们排除在外。产品要在浏览器里展示 Bot 队友时选它；它只跑在浏览器侧，需要宿主侧的 Bot 命名空间，缺少时什么都不渲染。

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

在 Web 侧边栏打开 Bots。面板在首页保留名册与创建表单，为每个 Bot 打开一条持续会话，并以名册中的 Bot 为成员发起群聊。信息抽屉编辑所选 Bot——名称、职责、头像，以及其会话所运行的权限预设（未固定时即部署默认值）。

### When to use it

产品需要在浏览器里展示 Bot 队友时使用。仅宿主侧或无界面的组合则跳过；它只添加这一个入口。

### The Bot chat resource

Bot 聊天就是在面板内渲染的普通 Session。资源提供者通过宿主的 `ensureConversation` 解析 `dsh-resource://botchat/bot/<id>`，在聊天打开期间保留返回的 Session，并让该会话的工作台界面安静下来——推理行、回合过程标签、用量药丸与会话统计都不显示。名册还会把这些会话发布到 session-visibility 面，因此所有 Workspace 浏览器列表都会将它们排除。

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer details — click to expand</summary>

`apply` 注册 `bots` 主面板（含 session 作用域的 `bot.chat` 槽位）、`BotConversationPage` 占用者与侧边栏条目，并提供聊天资源提供者与 session-visibility 面。面板注入面接线 `ctx.botsClient`（名册与房间状态）、workspace 列表，以及经由 `ctx.remote.permissionPresets.catalog()` 获取的权限目录，其已配置选项喂给抽屉里的权限控件。图标、`bot.roster` 字典与 CSS 随包发布。本包不发布运行时 invariant 伴随包：这个浏览器侧包不拥有任何宿主侧状态。

</details>

Source: [`packages/client/ui-bot/src/client/index.ts`](./src/client/index.ts)

-----

<a id="further-exploration"></a>
## Further Exploration

- [`@deepseek-ai/dsh-bot`](../../bot/bot/README.zh.md) —— 名册与每个 Bot 的持续会话。
- [`@deepseek-ai/dsh-api-bot-controller`](../../api/bot-controller/README.zh.md) —— 本面板消费的 Remote 命名空间。
- [`@deepseek-ai/dsh-api-remotes`](../../api/remotes/README.zh.md) —— 挂载该命名空间的客户端装配。

-----

<a id="model-experience"></a>
## Model Experience

无：本包只为人类渲染宿主观测到的 Bot 状态，不接触任何 prompt、消息、schema、流或工具结果。

#### KV Cache 影响

无；本包从不组装或发送 provider 请求。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **状态来自宿主投影** —— 面板只渲染 Bot 命名空间投影出的内容。记录、房间与会话都存放在宿主 profile 中；关闭 Bundle 只会移除界面，数据仍在磁盘上。
- **只支持已配置的预设** —— 抽屉只能固定部署对外提供的预设；实验性的当前会话 Auto 预设不是可持久化的 Bot 设置。
- **每个 Bot 一条会话** —— 每次打开都恢复同一个 Session，因此面板无法与同一个 Bot 并行开两段互不相关的聊天。

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer details — click to expand</summary>

该面板属于 Bots Bundle（`@deepseek-ai/dsh-bot-profile`）：只有选中该 Bundle 且宿主组合了 Bot 命名空间时才会渲染。浏览器可见文案位于 `src/client/locales.ts`，两种语言都必须保持完整。

</details>
