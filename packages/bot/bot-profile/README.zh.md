---
description: "从插件管理页启用持久 Bot 名册、单聊、群聊与任务交接。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-bot-profile

[English](README.md) | 中文

## Summary

这个可选 Bundle 插入标准 Web 组合中不含的四个 Bot 条目：`bot`、`bot-room`、`bot-controller` 和 `ui-bot`。出厂 profile 默认关闭它。

## Table of Contents

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

在 Web 侧栏打开「插件」并启用「Bots」。侧栏将出现 Bots 面板：一个持久的名册，每个 Bot 持有职责描述、preset、home workspace、可选头像，以及一条反复打开而非重新开始的持续会话。多个 Bot 可以组成群聊，群消息会被投递进每个成员自己的会话；Bot 也可以用 `handoff_to_bot` 把一件事交给另一个 Bot。关闭此 Bundle 会移除面板及其 Remote 命名空间；所有 Bot 记录、群日志与会话仍留在磁盘上，重新启用即原样恢复。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>维护者细节 — 点击展开</summary>

`cordis.patch.yml` 插入这四个条目，`package.json` 依赖它们的包，使每个条目都从此 Bundle 解析。`packages/boot/app-boot/src/profile.ts` 的 `OPTIONAL_BUNDLES` 列出此包，`apps/cli` 依赖它，因此每次安装都随包携带且默认关闭，插件管理页在「官方」分组中提供它。选中后会把该 Bundle 追加到 profile 的 `dsh.profile.bundles` 列表。此纯配置包不拥有可变的运行时状态，因此不发布不变量伴随模块。

| 文件 | 职责 |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | 插入 `bot`、`bot-room`、`bot-controller`、`ui-bot` 四个条目 |
| [`package.json`](package.json) | 把条目包声明为依赖 |
| [`locale/en.json`](locale/en.json)、[`locale/zh.json`](locale/zh.json) | 插件管理页的标题与描述 |
| [`icon.svg`](icon.svg) | 插件管理页图标 |
| [`src/index.ts`](src/index.ts) | 空模块入口；patch 才是运行时内容 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Bot 注册表](../../bot/bot/README.zh.md) — 持久记录、名册，以及每个 Bot 的持续会话。
- [Bot 房间](../../bot/bot-room/README.zh.md) — 群聊记录、消息日志与投递。
- [Web Bundle](../../bundle/web-app/README.zh.md) — 此 Bundle 向其添加条目的组合。

-----

<a id="model-experience"></a>
## 模型体验

### Bot 身份、交接与房间帧

#### 模型看到什么

在 Bot 自己的会话里，Agent 以该 Bot 的 persona 组合——名字、固定职责，以及一段有界的队友名册顶替部署 persona——并获得三个工具：`handoff_to_bot` 把一个任务投进另一个 Bot 的会话并在那里唤醒它；`list_bots` 给出更完整的队友描述；`ask_teammate` 向队友提一个问题，并把捕获到的回答作为新消息回传。群消息以一条有界帧到达成员：包含房间名、成员、最新日志行与被投递的文本；首 token 为 `[skip]` 的回复不会进入群日志。

#### Token 影响

persona、名册块与三个工具的 schema 位于该 Bot 会话请求的前缀中；名册块最多携带 12 位队友、每人描述 200 字符。每条投递帧不超过 4,000 字符，最多携带最近十条日志行、每行截断到 280 字符；完整群日志不会进入请求。

#### KV Cache 影响

Bot 会话组合时，persona 与工具变化会改变请求前缀。投递帧追加在前缀之后，不会使已有条目失效。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- Bundle 开启期间，它的页面会像其他 Bundle 一样为每个条目提供独立开关。这四个条目只有一起工作才有意义：关掉 `bot-controller` 会让面板失去 Remote 命名空间，关掉 `ui-bot` 会让服务失去面板。
- 当此 Bundle 未被选中时，任何按 id 定位 `bot`、`bot-room`、`bot-controller` 或 `ui-bot` 的 profile patch 或 `--patch` 覆盖都匹配不到条目：加载器会为每个这样的 patch 警告 `patch: entry <id> not found`。请选择此 Bundle，而不是按 id 单独开启条目。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者细节 — 点击展开</summary>

无。

</details>
