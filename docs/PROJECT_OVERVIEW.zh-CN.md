# dsh-bot 项目说明

本文根据本仓库当前源码、测试、补丁与已有文档整理，供仓库维护者快速把握项目全貌。结论都以代码为准；与 README / 注释不一致的地方单独标出。标有「不确定」的句子，是本仓库里没有对应实现、只能根据集成说明推断的部分。

现有 [README.md](../README.md) 与 [INSTALL.md](../INSTALL.md) 仍然保留，本文是补充说明，不替代各包自己的中英文 README。

## 1. 项目是什么，解决什么问题

`dsh-bot` 是从 [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) `0.2.0-rc.1` 工作树抽出的 **Bot Teammates（Bot 队友）插件套件**。它不是一个可以单独启动的应用，也不是一组可以直接 `npm install` 的包。五个包用 `workspace:*` 依赖 harness 核心包，目录布局与上游 monorepo 对齐，必须放回一份 deepseek-harness 检出里构建和运行。

它要解决的问题是：harness 里的对话默认是匿名 Session。这个套件在 Session 之上加一层**持久的命名队友**：

- 每个 Bot 有稳定 id（UUID）、显示名、职责描述、agent preset、可选头像、可选权限预设，以及可选的 home workspace。
- 每个 Bot 只有一条持续会话。第一次打开时按 preset（以及可选 workspace）创建普通 Session，之后每次打开都恢复同一条，而不是新开一段。
- 多个 Bot 可以组成群聊。房间自己持有只追加的消息日志，再把消息投进各成员自己的那条会话。
- Bot 之间可以交接任务（`handoff_to_bot`）、查看名册（`list_bots`）、异步请教（`ask_teammate`）。

产品形态是 Web 侧栏里的 **Bots** 面板。出厂 profile 默认不挂这套插件，用户在插件页打开「Bots 智能体名册」后才出现。

版本号与各包 `package.json` 一致，都是 `0.2.0-rc.1`，许可证为 MIT。各包 `repository` 字段仍指向 `deepseek-ai/deepseek-harness` 里的对应目录，而不是本仓库 `sudalk/dsh-bot`。

## 2. 主要功能

### 2.1 名册与画像

`BotRegistry`（Cordis 服务名 `ctx.bots`）维护一份持久名册：

| 能力 | 行为 |
|---|---|
| 创建 | 先校验画像，再写记录，最后把 id **前插**到名册顺序（最新在前）。 |
| 更新 | 只改传入字段。空操作不写盘、不发变更事件。头像和权限用空字符串表示清除，清除后键不会落盘。 |
| 删除 | 只删本条记录和名册槽位。不级联房间、Session 或正在跑的工作。 |
| 排序 | `insertBefore(id, beforeId?)`，语义接近 DOM 的 `insertBefore`；省略锚点则追加到末尾。 |
| 查找 | 按 id、按显示名（名册顺序中的第一个同名）、按会话 id。名称允许重复，身份是 `BotId`。 |

画像字段与上限（`packages/bot/bot/src/index.ts`、`types.ts`）：

- 名称 ≤ 120 字，职责 ≤ 4000 字。两者不可为空白，也不能带首尾空白。
- preset 不可为空白。创建表单里目前只提供写死的 `standard`（见第 8 节）。
- 头像是 `data:image/` URL，最长 400_000 字符。浏览器侧先把图片缩到 192×192 的 PNG（源文件上限 5 MB）。
- 权限是一个预设名，最长 120 字。空字符串表示跟随部署默认。内置展示名对应 `read-only`、`workspace-write`、`danger-full-access`；实际可选项来自部署的权限目录。
- `workspaceId` 可省略。省略时是「纯聊天 Bot」，会话走部署默认目录。给出的 workspace 必须已在 `workspaceRegistry` 中注册，否则创建失败、不写盘。

### 2.2 持续会话与模型侧身份

打开某个 Bot 的聊天时，`ensureConversation` 保证每个 Bot 同时只有一次创建在飞。Session 用该 Bot 的 `agentPreset` 创建；有 workspace 时带上 `workspaceId`。创建成功后把 `conversationId` 写回记录，先写入的那次获胜。

为这条会话组合出的 Agent 会在**自己的作用域**上安装：

- persona：英文身份段（名字 + 职责），外加一段中文名册前言。名册前言最多 12 位队友，每人职责截到 200 字；没有队友时不插入这段，避免白白占上下文。
- 三个工具：`handoff_to_bot`、`list_bots`、`ask_teammate`。
- 钉住的权限预设：写到该 Agent 的 Session 上，供沙箱和审批在调用时读取。没有权限服务、或预设名不在部署列表里时，只打警告并保持部署默认，不让组合失败。画像变更会立刻作用到已经打开的会话；清空钉则把当前会话改回 `defaultPreset`。

其他 Session 不会得到这套 persona 和工具。

### 2.3 三个协作工具

| 工具 | 作用 | 上限 |
|---|---|---|
| `handoff_to_bot` | 把一件任务投进目标 Bot 自己的会话并唤醒它。任务留在对方聊天里，用户可以打开那条会话看进度。 | 任务正文 8000 字；一条链最多 3 跳。禁止交给自己，也禁止立刻交回刚刚把任务交过来的人。 |
| `list_bots` | 按需列出除自己以外的全部队友，描述截到 500 字。 | 无调用参数。 |
| `ask_teammate` | 向队友提一个问题。问题进入对方会话；对方这一轮的文字回复再作为新消息回到提问者，双方都不握着一次同步调用等待对方。 | 问题 4000 字，回传答案 8000 字；一条链最多 3 轮。禁止问自己、禁止空白问题、禁止在对方正等自己回答时反问回去。 |

交接和咨询的投递文本是中文帧（`[任务交接]`、`[队友咨询]`、`[咨询回复]`）。persona 正文本身是英文。模型看到的是中英混合前缀。

### 2.4 群聊

`BotRooms`（`ctx.botRooms`）提供一等公民的群聊。房间**不是** Session：

- 成员 2 到 6 个，必须是已注册 Bot，不能重复。
- 房间名 ≤ 120 字；单条消息 ≤ 8000 字。
- 日志只追加。作者按发送当时的显示名记下来，之后改名不改历史。
- 发消息时在进模型之前解析 `@成员`。匹配规则是「从 `@` 起的最长成员名」，所以「测试」和「测试助手」可以区分。别名 `@everyone`、`@所有人`、`@全体成员` 会被识别（投递时怎么用，见第 8 节）。
- 没有显式点名时，用户消息会投给全体成员；Bot 回复不会再投回自己。
- 每条投递是目标 Bot 自己会话里的一条带框用户消息：房间名、成员、最近日志、正文，以及回复规则。帧上限 4000 字，最多折进最近 10 行、每行 280 字。
- 回复的第一个非空白 token 若是 `[skip]`（大小写不敏感），这条回复不进房间日志。
- 回复里的 `@成员` 会变成下一跳交接。一条根消息最多 8 次投递，交接链最多 4 层，超出后在房间里写一条系统说明。
- 同一 Bot 同时最多有一条已受理、等待回合结束的投递，其余排在该 Bot 的队列里。回复捕获只认受理之后打开的第一个回合，避免把队列前面无关的工作当成回答。
- 投递把房间消息 id 记在 Session 的 `room-message` source 上，重放时可跳过。
- `subscribe` 发布房间增删改和消息；`subscribeActivity` 发布成员「工作中 / 待命」。

### 2.5 浏览器 Remote 与面板

`BotController` 以 Typert Remote 命名空间 `bot` 注册为 `ctx.botController`。变更返回完整权威行；`follow` / `roomsFollow` 先发一份 baseline，再发增量，重连时客户端整份替换，不用自己做 diff。

浏览器面板（`@deepseek-ai/dsh-client-ui-bot`）提供：

- 侧栏入口，顺序 `order: 11`，文案命名空间 `bot.roster`（中英词典都在 `locales.ts`）。
- 左侧会话栏：单聊列表、群聊列表、「新建 Bot / 群聊」。
- 首页：名册、创建表单（名称、preset、职责、可选 workspace、可选权限）、勾选 Bot 后「发起群聊」。群名默认是成员名用顿号拼起来。
- 单聊：资源地址 `dsh-resource://botchat/bot/<id>`，经 `ensureConversation` 拿到 Session 并 `retain`，来源标记为 `botChat`。打开超时 15 秒。界面固定为聊天视图，并请求隐藏模式控件和上下文计量。
- 群聊时间线：Markdown 渲染、成员芯片插入 `@名字`、Enter 发送、Shift+Enter 换行。打开房间时拉一次完整日志，之后靠流追加。
- 信息抽屉：改名、改职责、换头像、钉权限、删 Bot；或改群名、加减成员、删群。删 Bot 的文案写明「参与过的群聊会保留」。删群会连消息一起删，Bot 和单聊不动。

名册还会把自己的 `conversationId` 发布到 `sessionVisibility`，让工作区会话列表把这些 Session 排除掉。这一点要上游打了 `05-ui-workspace.patch` 才会生效。

## 3. 技术栈与关键依赖

本仓库没有根 `package.json`、锁文件或独立运行时。技术栈是「TypeScript ESM 插件 + Cordis 服务」，嵌在 harness 里。

| 层次 | 用到什么 |
|---|---|
| 语言 / 模块 | TypeScript，`"type": "module"`。路径别名指向 `src/`，构建产物约定在 `lib/`（本仓库不提交 `lib/`）。 |
| 插件运行时 | `@deepseek-ai/cordis`（`Service`、`Context`、`inject`、`effect`）。Host 包默认导出服务类；浏览器包导出 `apply`。 |
| 校验 | `zod` `^4.4.3`（`bot-room` 钉死 `4.4.3`）。记录在持久化边界校验。 |
| 存储 | `@deepseek-ai/dsh-storage` + `@deepseek-ai/dsh-storage-domain`。Bot 域 `bot` version 1：表 `bots` + global `botIds`。房间域 `bot_room` version 1：表 `rooms`、`messages`，没有 global。 |
| 会话 / Agent | `@deepseek-ai/dsh-session`、`@deepseek-ai/dsh-agent`、`@deepseek-ai/dsh-api-session-controller`、`@deepseek-ai/dsh-llm`、`@deepseek-ai/dsh-tools`、`@deepseek-ai/dsh-system-prompt`。 |
| 工作区 / 权限 | `@deepseek-ai/dsh-workspace`（创建时可选）、`@deepseek-ai/dsh-permission-presets`（钉权限时可选）。 |
| 浏览器传输 | `@deepseek-ai/dsh-typert-protocol` 的 `TypertRemoteService` / `@Remote`，客户端用 `@deepseek-ai/dsh-api-gateway` 的 `RemoteSnapshotStream`。队列用 `@deepseek-ai/dsh-deque`。 |
| UI | React 18、`clsx`、harness 的 layout / sidebar / chat / conversation / primitives / slots。CSS Modules。 |
| 打包 | `bot-controller` 与 `ui-bot` 的 `bundle` / `watch` 脚本调用 `tsdown`。配置 `import` 的是 harness 里的 `tsdown.client.ts`，**本仓库没有这个文件**。 |
| 测试 | 规格文件使用 Vitest（`describe` / `it` / `vi`）。见第 7 节。 |
| id | `@deepseek-ai/dsh-brand` 的 branded string。Bot / Room / 消息 id 都是 `randomUUID()`。 |

运行期还依赖 harness 已有能力，INSTALL 写明不需要额外插件：权限钉走 `@deepseek-ai/dsh-permission-presets`，Agent preset 走 `@deepseek-ai/dsh-preset`。缺权限服务时钉只被记下，按部署默认执行。

Node 与 pnpm 的版本要求不在本仓库里声明。INSTALL 写的是：Node `^22.19 || >=24`，pnpm 使用 harness 仓库自己的 `packageManager`。这一点以集成目标检出为准。

## 4. 目录与模块

```
dsh-bot/
├── README.md                 双语简介与包索引
├── INSTALL.md                集成步骤、补丁表、冒烟清单
├── patches/                  打到 deepseek-harness 上的 7 个补丁
└── packages/
    ├── bot/bot               @deepseek-ai/dsh-bot
    ├── bot/bot-room          @deepseek-ai/dsh-bot-room
    ├── bot/bot-profile       @deepseek-ai/dsh-bot-profile
    ├── api/bot-controller    @deepseek-ai/dsh-api-bot-controller
    └── client/ui-bot         @deepseek-ai/dsh-client-ui-bot
```

### 4.1 `packages/bot/bot` — 名册、身份、协作工具

Host 服务。入口 `src/index.ts`，默认导出 `BotRegistry`。

| 文件 | 职责 |
|---|---|
| `src/index.ts` | 注册表：校验、名册顺序、会话打开、咨询回传、权限应用。 |
| `src/entity.ts` | 包内私有的 `Bot` 实现。所有字段变更走 `mutate`，并盖 `updatedAt`。 |
| `src/spec.ts` | 域 spec 与 zod 记录形状。持久格式只应在这里声明。 |
| `src/types.ts` | `Bot` / `BotProfile` 等对外类型。`BotId` 是品牌类型。 |
| `src/identity.ts` | 把 persona 装进 Agent 作用域的 `deployment:persona-prefix`。 |
| `src/roster.ts` | 名册前言与 `list_bots`。 |
| `src/handoff.ts` | `handoff_to_bot` 与交接帧。 |
| `src/consult.ts` | `ask_teammate` 与问答帧。 |
| `src/permission.ts` | 把预设写到 Session，或恢复部署默认。 |
| `src/tool-shared.ts` | 截断字符串、工具 JSON 输出。 |
| `src/invariant.ts` | 可选伴随模块 `@deepseek-ai/dsh-bot/invariant`：断言缓存与 `bots` 表双向一致。 |
| `tests/*.spec.ts` | 画像、注册表、权限、名册、交接、咨询、不变量。 |

### 4.2 `packages/bot/bot-room` — 房间与投递

Host 服务。入口 `src/index.ts`，默认导出 `BotRooms`。`inject` 为 `storageDomain`、`bots`、`sessionController`。

| 文件 | 职责 |
|---|---|
| `src/rooms.ts` | `BotRoomStore`：房间与日志的缓存、校验、串行写入。 |
| `src/delivery.ts` | `BotRoomDelivery`：受众、按 Bot 队列、回复捕获、扩散预算。 |
| `src/mentions.ts` | `@成员` 与 everyone 别名。 |
| `src/frame.ts` | 投递帧与 `[skip]`。 |
| `src/limits.ts` | 人数、长度、投递次数、帧大小，测试与实现共用。 |
| `src/spec.ts` | `bot_room` 域。`rooms.sessionId` 是已退役字段，只为旧记录能读出来，读写路径都不再使用。 |
| `tests/rooms.spec.ts` | 存储、成员、日志、提及、组框。不覆盖投递队列和回复捕获。 |

本包明确不发布 invariant 伴随模块：除域表之外没有另一份可独立观测的状态。

### 4.3 `packages/bot/bot-profile` — 插件开关

配置包，不是业务服务。`src/index.ts` 是空模块。真正的运行时内容是 `cordis.patch.yml`，一次插入四行：

| id | 包 |
|---|---|
| `bot` | `@deepseek-ai/dsh-bot` |
| `bot-room` | `@deepseek-ai/dsh-bot-room` |
| `bot-controller` | `@deepseek-ai/dsh-api-bot-controller` |
| `ui-bot` | `@deepseek-ai/dsh-client-ui-bot` |

`package.json` 的 `dsh.bundle.patch` 指向这份 YAML。`locale/zh.json` 的插件标题是「Bots 智能体名册」，描述是「持久 AI 队友：各自的单聊、群聊与任务交接。」`icon.svg` 是插件页图标。`tests/profile.spec.ts` 检查 manifest 与这四行插入。

### 4.4 `packages/api/bot-controller` — Remote 命名空间

Host 入口 `src/index.ts`（`BotController`），浏览器入口 `src/client/`。`tsconfig.json` 只做 host / client 两个工程引用。

Remote 动词：

| 分组 | 动词 |
|---|---|
| 名册 | `create`、`update`、`delete`、`insertBefore`、`ensureConversation` |
| 房间 | `roomsList`、`roomsGet`、`roomsCreate`、`roomsRename`、`roomsDelete`、`roomsAddMember`、`roomsRemoveMember` |
| 消息 | `roomsMessages`、`roomsPost` |
| 流 | `follow`、`roomsFollow` |

`src/client/model.ts` 在浏览器里维护名册和房间快照。`src/client/service.ts` 把 Remote 结果收成 `ctx.botsClient`，失败时抛 `BotRemoteCommandError`。`src/client/index.ts` 的 `apply` 启动两条可重连的 snapshot 流。

导出面还包括 `./typert`、`./remote`（由 harness 的描述符生成流程产出 `lib/typert.*.js`，源码树里没有这些生成文件）。`tsdown.config.ts` 指向仓库外的 `packages/client/tsdown.client.ts`。

本目录没有测试文件。

### 4.5 `packages/client/ui-bot` — 浏览器面板

| 文件 | 职责 |
|---|---|
| `src/index.ts` | Host 侧空 `apply`。注释写明名册行为只在浏览器入口。 |
| `src/client/index.ts` | 注册主面板 `bots`、槽位 `bot.chat`、侧栏图标、聊天资源、`sessionVisibility`。 |
| `src/client/BotManagerPage.tsx` | 会话栏、名册首页、创建表单、把单聊 / 群聊装进右栏。 |
| `src/client/BotConversationPage.tsx` | 单聊头（头像、职责、工作中/待命）和嵌入式会话。 |
| `src/client/RoomPane.tsx` | 群时间线与输入框。 |
| `src/client/InfoDrawer.tsx` | Bot / 房间设置。成员上下限在 UI 里再写了一遍：最少 2、最多 6。 |
| `src/client/botChatResource.ts` | `dsh-resource://botchat/bot/<id>` 的编解码。`?attempt=N` 只是重试 nonce。 |
| `src/client/avatar.ts` | 选图、等比缩放到 192 边长、编码 PNG data URL。 |
| `src/client/permission-display.ts` | 三个内置预设的中英文标签；其余用目录名，目录里也没有时显示原始值。 |
| `src/client/locales.ts` | `bot.roster` 的完整中英词典。 |
| `src/client/*.module.css` | 面板、抽屉、房间样式。 |

`tsdown.config.ts` 同样依赖仓库外的 `packages/client/tsdown.client.ts`。本目录没有测试文件。

### 4.6 `patches/` — 打到 harness 上的改动

这些补丁改的是 **deepseek-harness**，不是本仓库里的文件。按 INSTALL：3 张必打，4 张可选。

| 补丁 | 是否必打 | 改什么 |
|---|---|---|
| `01-client-remote-mount.patch` | 必打 | 客户端 remote 装配挂上 `botRemote`，并加上 tsconfig 引用。不打则浏览器没有 `bot` 命名空间。 |
| `02-session-controller-bot-chat-source.patch` | 必打 | `SessionReferenceSourceMap` 增加 `botChat`。不打则 ui-bot 的 `sessions.retain(..., { source: 'botChat' })` 类型检查失败。 |
| `02b-session-controller-agent-preset.patch` | 可选 | 客户端 `ISessions.create` 增加可选 `agentPreset`。Bot 会话是 Host 创建的，INSTALL 写明当前没有调用方。 |
| `03-ui-chat.patch` | 可选 | 单聊隐藏 reasoning、Turn 过程、用量、会话统计；为 `bot-consult` / `bot-consult-answer` 提供标题。 |
| `04-ui-conversation.patch` | 可选 | 会话骨架增加 `hideModeControls` / `hideContextMeter`。ui-bot 已经在传这两个属性。 |
| `05-ui-workspace.patch` | 可选 | 新增 `visibility.ts`，工作区列表读取 `sessionVisibility`。不打则 Bot 会话会出现在工作区列表里。 |
| `06-workspace-wiring.patch` | 必打 | `tsconfig` 别名与工程引用、`apps/cli` 依赖 `dsh-bot-profile`、`OPTIONAL_BUNDLES` 加入该包。不打则构建找不到包，插件页也没有开关。 |

## 5. 主流程

### 5.1 进程怎么把四个插件挂起来

没有独立入口文件。harness 的 Loader 按 profile 里的 Cordis 行启动插件：

1. 用户在插件页启用 `@deepseek-ai/dsh-bot-profile`，或手写与 `cordis.patch.yml` 等价的四行 `insert`。
2. `bot` 启动：`storageDomain.open(botDomainSpec)`，校验 `botIds` 与 `bots` 表一致，重建实体缓存。监听 `agent/created` 以便冷启动恢复身份；监听 `session/event` 做咨询回传。
3. `bot-room` 启动：打开 `bot_room` 域，把房间和消息读进内存，开始监听 `session/event` 做房间回复捕获。
4. `bot-controller` 启动：订阅 `domain/changed`（只看 `bot` 域的 `bots` 表）、房间变更和活动流，向已连接的浏览器 follower 推帧。
5. `ui-bot` 的 Host `apply` 是空的。浏览器包的 `apply` 注册面板，并依赖已经挂上的 `ctx.remote.bot` 与 `ctx.botsClient`。

启动时如果名册顺序重复、顺序指向不存在的记录、或表里有未列入顺序的记录，`BotRegistry` **直接抛错拒绝打开**，不会静默修补。`validateStoredState` 上方的注释写了「缺记录就丢掉顺序项、缺顺序就追加」，与实现和测试不符，以代码为准。

### 5.2 创建 Bot 并打开单聊

```
浏览器创建表单
  → botsClient.create
  → remote.bot.create
  → ctx.bots.create
       校验画像
       若带了 workspaceId，则必须能在 workspaceRegistry 里查到
       写 bots 表，再把 id 前插进 global.botIds
  → domain/changed → follow 流 upsert
  → 用户点「聊天」
  → 资源 dsh-resource://botchat/bot/<id>
  → ensureConversation
       已有 conversationId：直接返回，并给已组合的 Agent 补身份
       否则 sessionController.create({ agentPreset, workspaceId? })
       adoptConversation 把 sessionId 写回记录
  → sessions.retain(sessionId, { source: 'botChat' })
  → BotConversationPage 渲染嵌入式聊天
```

`sessionController.create` 期间就会组合出第一个 Agent，那时记录上还没有 `conversationId`，`agent/created` 对不上 Bot。所以 `openAdmitted` 在 adopt 之后会再调一次 `repairIdentity`。之后的冷恢复走 `agent/created`。

用户在单聊里发消息，走的是 harness 普通 Session，不经过 bot-controller。Bot 的 persona、名册和三个工具已经装在这个 Agent 上。

### 5.3 群聊投递

```
浏览器输入框 postRoomMessage
  → roomsPost（署名固定为 kind:user、senderName:「用户」）
  → BotRoomDelivery.post
       parseRoomMentions
       appendMessage（先落日志，再投递）
       为每个目标 enqueue
  → 每个目标 ensureConversation + resolveAgent
  → agent.followup(带框用户消息, source.kind = room-message)
  → 目标回合 turn/end
  → 非 [skip] 的文字回复 appendMessage(senderKind: bot)
  → 回复里的 @成员 再 enqueue（深度 + 1，受预算限制）
  → 房间 subscribe / activity → roomsFollow → RoomPane
```

投递队列、正在等待的回复、扩散预算都在进程内存里。消息正文本身在 `messages` 表里，重启后日志还在，但「已经追加、还没受理」的那一轮投递不会自动重放。

### 5.4 交接与咨询

交接不建房间。`handoff_to_bot` 解析显示名，检查深度和回弹，然后 `deliverHandoff`：确保目标会话存在，`followup` 一条 `bot-handoff` 用户消息。

咨询多一步回传。`deliverConsult` 把待回复记在 `consultPending` 里，键是**目标会话 id**。目标下一个新回合结束时，把文字（没有文字则用「（对方没有给出文字回复）」）以 `bot-consult-answer` 送回提问者。这条表也在内存里；`bot.consultReply` 这个 effect 被拆掉时会清空。进程重启后，还没折返的问答没有回传。

### 5.5 数据落在哪里

代码里的域名字是 `bot` 和 `bot_room`。INSTALL 写明集成后的 JSON 文件是 `~/.dsh/storages/bot.json` 与 `bot_room.json`。文件名来自 harness 的 storage-json 后端约定，**本仓库没有该后端的实现**，因此文件名以 INSTALL 为准，没有在这里再次核对。

Session 正文不在这两份文件里。`conversationId` 只是指向 harness 自己的 Session 存储。关掉 Bundle 会卸掉面板和 Remote，记录、房间日志和会话仍留在磁盘上，再次启用会读回来。

本仓库没有环境变量，也没有密钥、令牌或模型 endpoint 配置。模型、权限和目录都由 harness 部署决定。权限钉存的是预设**名字**，不是凭据。

## 6. 安装、配置与运行

不能在本仓库根目录执行 `pnpm install` 后直接跑。步骤以 [INSTALL.md](../INSTALL.md) 为准，这里只复述结构，不重复补丁冲突细节。

### 6.1 前置

- 一份 deepseek-harness 检出，基线 `0.2.0-rc.1`（INSTALL 标注为 2026-10-05 的工作树导出）。
- Node 与 pnpm 按该检出的要求。INSTALL 写的是 Node `^22.19 || >=24`。
- 核心包 `@deepseek-ai/dsh-*@0.2.0-rc.1` 可从公共 npm 获取。本套件本身仍用 `workspace:*` / `link:`，不在本仓库里发布。

### 6.2 放入包并打补丁

把 `packages/` 下五个目录复制到检出的相同相对路径。不要覆盖 harness 自带的 `packages/api/remotes`、`packages/api/session-controller`、`packages/client/ui-chat`、`ui-conversation`、`ui-workspace`；那些目录由补丁修改。

在 harness 检出里按文件名顺序 `git apply --check` 再 `git apply`。最少要打 `01`、`02`、`06`。上游漂移时 INSTALL 建议 `git apply --3way`。冲突热点它点名了：`packages/api/remotes/src/client/index.ts`、`packages/api/session-controller/src/client/*`、`packages/client/ui-chat/src/client/presentation-policy.ts`、`packages/client/ui-workspace/src/client/{tree,index}.ts`，以及 `06` 里手写的 tsconfig 别名。

### 6.3 配置（没有环境变量）

本仓库不读取 `process.env`，也没有 `.env` 示例。配置是 profile 依赖和 Cordis 组合。

在目标 profile（INSTALL 的例子是 `~/.dsh/profiles/web`）的 `package.json` 里加上五个包。同 monorepo 内写 `workspace:*`；检出外写 `link:<绝对路径>/packages/...`；若以后发到 registry，再改成版本号。不要把真实 token 写进这份依赖声明；这五个包名里也不含密钥。

挂载二选一：

- 推荐：打完 `06` 后，Web 插件页会出现「Bot Teammates / Bots 智能体名册」，打开即插入四行。
- 手写：在 profile 的 cordis 配置里 `insert` `bot`、`bot-room`、`bot-controller`、`ui-bot`。Bundle 未选中时，按这四个 id 去打 patch 会匹配不到行，加载器警告 `patch: entry <id> not found`。

四行需要一起工作。只关 `bot-controller`，面板没有 Remote；只关 `ui-bot`，服务没有界面。

### 6.4 构建与启动

在 **harness 检出**里，而不是本仓库：

```bash
pnpm install
pnpm build            # 增量改动至少 pnpm run build:lib
pnpm dsh --profile web --no-open --port 3080
```

INSTALL 的冒烟清单：侧栏出现 Bots；能创建 Bot；单聊有回复；群聊里 @ 成员后，回复折回房间日志；把权限钉成「完全权限」后，写工作区外文件应不再审批（权限服务在线时）；打了 `05` 时，Bot 对话不出现在工作区会话列表。

`3080` 只是 INSTALL 里的示例端口，不是本仓库写死的配置。

## 7. 测试、构建与部署

### 7.1 测试

已有规格（Vitest 风格）：

| 文件 | 覆盖 |
|---|---|
| `packages/bot/bot/tests/bot.spec.ts` | 画像校验、创建/更新/删除/排序、重启重建、写失败回滚、纯聊天 Bot、权限钉的保存与即时生效。 |
| `packages/bot/bot/tests/roster.spec.ts` | 名册前言、`list_bots`、persona 与工具是否装上。 |
| `packages/bot/bot/tests/handoff.spec.ts` | 交接帧与 `handoff_to_bot` 的拒绝条件。 |
| `packages/bot/bot/tests/consult.spec.ts` | 咨询帧、轮次上限，以及注册表把回答送回提问者。 |
| `packages/bot/bot/tests/invariant.spec.ts` | 缓存与表不一致时失败。 |
| `packages/bot/bot-room/tests/rooms.spec.ts` | 房间存储、成员边界、提及、组框、`[skip]`。 |
| `packages/bot/bot-profile/tests/profile.spec.ts` | bundle manifest 与四行 patch。 |

这些测试 **不能在本仓库里单独跑**。它们 import harness 路径，例如 `packages/storage/storage-domain/tests/helpers/memory-backend.ts`，以及 `@deepseek-ai/dsh-storage` 等包；本仓库没有这些包，也没有 Vitest 配置或 `test` script。`bot-controller` 和 `ui-bot` 没有规格文件。`bot-room` 的投递队列、去重、活动状态没有直接测试。

各包 README 的 `README.i18n.yaml` 是双语段落哈希，注释写明要用 harness 的 `pnpm run verify-translation-pairing` 更新。该脚本不在本仓库。

### 7.2 构建

各包 `tsconfig*.json` 都 `extends` 仓库外的 `../../../tsconfig.base.json` 或 `tsconfig.base.client.json`，`references` 指向 harness 里的 cordis、session、storage、workspace 等目录。因此类型检查和 `pnpm build` 只在打过 `06` 的 harness 检出里有意义。

`bot-controller` 与 `ui-bot` 有 `bundle` / `watch`（tsdown）。它们的配置文件 import 本仓库不存在的 `tsdown.client.ts`。Remote 的 `lib/typert.host.js` 与 `lib/typert.remote-client.js` 也不在源码树里，要由 harness 的描述符生成步骤产出。改 Remote 动词之后，需要先重建 Host 面，再构建消费方；这是 bot-controller README 的说明，生成脚本本身不在本仓库。

`.gitignore` 忽略 `node_modules/`、`lib/`、`dist/`、`*.tsbuildinfo`。

### 7.3 部署

本仓库没有 Dockerfile、CI workflow、发布脚本或进程管理配置。部署方式就是第 6 节的集成：包放进 harness、打补丁、在 profile 里启用 Bundle，然后用 harness 自己的 `pnpm dsh` 启动。

`publishConfig.access` 为 `public`，但当前依赖仍是 `workspace:*`。README 写明「暂不独立成构建单元」。是否已经发到 npm，本仓库看不出来。

## 8. 缺口、TODO 与风险

下面都是读代码时能直接看到的，不是推测中的产品路线。

### 8.1 集成与仓库形态

- 不能独立安装、构建或测试。缺 harness 时，`workspace:*`、tsconfig `extends`、测试 helper、tsdown 辅助文件、Remote 生成物都不存在。
- 补丁针对 `0.2.0-rc.1`。上游一旦重排 `tsconfig.base.json` 或 remote 装配表，`git apply` 会冲突。INSTALL 把这点写成已知漂移。
- 各包 `repository.url` 仍是 `https://github.com/deepseek-ai/deepseek-harness.git`。若本仓库要单独发版，这个字段会指向错误的源码位置。
- 没有 CI。补丁能否打上当前 harness，本仓库自己验证不了。

### 8.2 文档和注释与代码不一致

- `packages/bot/bot` 的 README「已知限制」仍写：Bot 记录不拥有对话，把 Bot 和 Session 关联起来并暴露给模型是消费者的事。当前 `BotRegistry` 已经拥有持续会话、persona、三个工具和权限钉。同一份 README 的 Model Experience 又描述了这些能力。以 `src/index.ts` 为准，那段限制已经过时。
- README 的 Setting up 仍写：没有 workspace 插件时每次创建都失败。代码允许省略 `workspaceId`（纯聊天 Bot）；只有**指定了**未注册的 workspace 才失败。创建表单默认就是「不指定工作区」。这是最近一次提交（workspace 可选）之后，包 README 没有跟上。
- `validateStoredState` 的注释描述了自动修补；实现和 `bot.spec.ts` 都是不一致就抛错。
- `BotController` 的类注释写它拥有 Bot 身份和房间路由。身份安装在 `BotRegistry.installIdentity`，房间路由在 `BotRoomDelivery`。控制器只做投影和 Remote。

### 8.3 行为缺口

- **一个 Bot 一条 Session。** 单聊和所有群聊的投递、交接、咨询都进同一条上下文，会互相交错。面板也不能对同一个 Bot 开两段独立聊天。这是 README 和代码一致的限制。
- **咨询回传表按目标会话覆盖。** `consultPending` 的键是目标 `sessionId`。同一 Bot 上还没结算的下一次咨询会覆盖上一次，先到的回答可能对不上原来的问题。进程重启也会丢掉未折返的问答。
- **房间投递状态在内存里。** 追加消息和受理投递之间崩溃，日志还在，投递不会补做。
- **删除不级联。** 删 Bot 不删它的 Session，也不把它移出房间。`describeMembers` 在记录没了的时候用 id 当显示名。房间成员若已不在名册，投递会写一条系统说明并跳过。
- **`@everyone` 没有真正参与投递。** `parseRoomMentions` 算出 `everyone`，但 `post` 只把 `botIds` 写入 `mentions`。没有任何点名时（包括只写了 `@所有人`）会投给全体，这和「没 @ 任何人」是同一条分支。若同一条消息里既有成员名又有 everyone 别名，投递只面向被点名的成员，别名被丢掉。测试只断言解析结果，没有断言投递受众。
- **名册重排不会进 follow 流。** `BotFollowIncrement` 有 `order` 帧，客户端也处理它，但 `BotController.changed` 只转发 `bots` 表的 upsert/remove。顺序存在域的 global 里。发起排序的那个客户端会用命令返回值更新本地顺序；其他已连接的客户端要等重连 baseline 才看得到新顺序。不确定 global 的 `domain/changed` 是否另有事件，本控制器没有订阅它。
- **`delete` 的 Remote 总是返回 `{ deleted: true }`。** `ctx.bots.delete` 对未知 id 返回 `false`，控制器没有把这个结果传出去。房间删除则会在不存在时抛 `bot/room-not-found`。
- **群发按钮不检查人数。** 只要勾选了至少 1 个 Bot 就显示「发起群聊」，Host 却要求 2–6 人。1 个或超过 6 个会在创建时失败，首页用通用的「无法加载 Bots」提示，容易看不懂。
- **创建时的 preset 只有 `standard`。** Host 接受任意非空 preset 字符串，更新接口也能改 `preset`，但信息抽屉不能改 preset，创建表单也没有预设目录。
- **浏览器发群消息的作者固定为「用户」。** 不区分调用方。这是 bot-controller README 已写明的限制。
- **`roomsMessages` 没有分页游标。** 不传 `limit` 时 Host 返回内存里的整段日志；面板打开房间时就是这样调的。传了 `limit` 才是「最新 N 条」，更早的记录没有下一页接口。日志会随进程全量留在房间缓存里。
- **头像 data URL 写进 Bot 记录。** 上限 400_000 字符。每条记录都会被名册读者反序列化，大头像会撑大 `bot` 域。
- **权限钉不是豁免群聊。** 每个 Bot 用自己记录上的预设。未钉、服务不存在、或名字不在目录里，都退回部署默认，并 `logger.warn`。
- **模型可见文本中英混合，** 且交接/咨询/群聊帧是中文硬编码，不随 UI 语言切换。`snapshotEvents` 在交接、咨询、房间去重里被标成 deprecated，注释写 migration deferred。
- **记忆、技能选择、MCP 连接器不在记录里。** 名册是一条扁平列表，没有置顶、分组或按用户排序。这两点仍与 bot README 的「已知限制」一致。
- **可选补丁决定体验是否完整。** 不打 `03`/`04`，单聊会露出工作台式过程和模式控件；不打 `05`，Bot 会话混进工作区列表。`chatTranscript?.set` 和未实现的 slot 属性是软依赖，缺了不会在本包里抛错。

### 8.4 本仓库里没有的 TODO 标记

源码里没有 `TODO` / `FIXME` 注释。推迟项写在各包 README 的 Known Limitations，以及上面几处 `oxlint-disable`（`snapshotEvents` 迁移推迟）。`bot-room` 的 Dev Note 是 “None.”。
