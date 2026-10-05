# 安装与适配 / Install & Integration

本仓库**不是**可直接 `npm install` 的包集合：5 个包用 `workspace:*` 依赖 deepseek-harness 的核心包，必须集成进一份 deepseek-harness 检出。集成 = 放入包 + 打本目录 `patches/` 下的补丁 + 接线 profile。

*This repo is not an installable npm package set: its 5 packages depend on deepseek-harness core via `workspace:*`. Integration = drop in the packages, apply the patches under `patches/`, and wire the profile.*

基线 / Baseline：deepseek-harness **0.2.0-rc.1**（2026-10-05 工作树导出）。核心包 `@deepseek-ai/dsh-*@0.2.0-rc.1` 在公共 npm 可获取。

## 0. 前置 / Prerequisites

- deepseek-harness 检出，基线 `0.2.0-rc.1`；Node `^22.19 || >=24`，pnpm（仓库自带 `packageManager` 声明）。
- 运行期依赖均为 stock 能力，无需额外插件：权限钉走 `@deepseek-ai/dsh-permission-presets`，Agent preset 走 `@deepseek-ai/dsh-preset`（二者在主线组合里）。缺权限服务时权限钉只记录、按部署默认执行，不报错。

## 1. 放入包 / Drop in the packages

把 `packages/` 下 5 个目录复制到检出对应位置，保持 monorepo 结构：

```
packages/bot/bot               # Bot 记录/名册/会话/handoff/ask_teammate
packages/bot/bot-room          # 群聊：房间、只追加日志、投递
packages/bot/bot-profile       # Bundle：profile 开关（cordis.patch.yml）
packages/api/bot-controller    # Remote 命名空间（浏览器端读名册/房间）
packages/client/ui-bot         # Bots 面板：名册页、单聊、群聊、信息抽屉
```

`packages/api/remotes`、`packages/api/session-controller`、`packages/client/ui-chat|ui-conversation|ui-workspace` 是上游自带目录——第 2 步的补丁修改它们，**不要**覆盖。

## 2. 应用补丁 / Apply the patches

按文件名顺序；三张必打，四张可选（决定体验完善度，不影响能否装起来）。

| 补丁 | 必打? | 作用 | 缺失后果 |
|---|---|---|---|
| `01-client-remote-mount.patch` | ✅ 必打 | 客户端 remote 装配挂上 `botRemote`（`@deepseek-ai/dsh-api-bot-controller/remote`），并接 tsconfig 引用 | 浏览器端没有 bot 命名空间，面板请求全挂 |
| `02-session-controller-bot-chat-source.patch` | ✅ 必打 | `SessionReferenceSourceMap` 增加 `botChat` source | ui-bot 调 `sessions.retain(..., { source: 'botChat' })`，不打则 TS 编译失败 |
| `02b-session-controller-agent-preset.patch` | 可选 | 客户端 `ISessions.create` 增加可选 `agentPreset` | 无当前调用方（Bot 会话由 Host 侧创建，`SessionCreateRequest.agentPreset` 是 stock 能力）；不打只是客户端 API 与 Host 不对称 |
| `03-ui-chat.patch` | 可选 | `chatTranscript` 呈现覆盖面 + Bot 单聊的聊天化：隐藏 reasoning / Turn 过程 / 用量 / 会话统计；`bot-consult` / `bot-consult-answer` 两个消息 source 的标题与 Turn 标签 | Bot 单聊透出「工作台」式过程信息；咨询问答在 UI 上退化为通用文本 |
| `04-ui-conversation.patch` | 可选 | 会话骨架新增 `hideModeControls` / `hideContextMeter` slot 属性 | Bot 聊天顶部出现模式选择 / 上下文计量等对队友无意义的控件 |
| `05-ui-workspace.patch` | 可选 | 工作区浏览器读取 `sessionVisibility` 面（新增 `visibility.ts`），隐藏 Bot 对话 | Bot 的对话会混进工作区会话列表 |
| `06-workspace-wiring.patch` | ✅ 必打 | `tsconfig.base.json` 别名（7 条 bot + 2 条 `/types` 手写）、`tsconfig.host.json` / `tsconfig.client.json` 引用、`apps/cli` 依赖 `dsh-bot-profile`、`OPTIONAL_BUNDLES` 加入 `@deepseek-ai/dsh-bot-profile` | 构建找不到包；插件页没有开关 |

应用方式（逐条先 check 再 apply）：

```bash
cd <deepseek-harness>
for p in <this-repo>/patches/0*.patch; do git apply --check "$p" && git apply "$p"; done
# 只打必打项：
git apply <this-repo>/patches/01-client-remote-mount.patch
git apply <this-repo>/patches/02-session-controller-bot-chat-source.patch
git apply <this-repo>/patches/06-workspace-wiring.patch
```

补丁里的 `presentation-overrides.ts`、`visibility.ts` 是纯新增文件，`git apply` 会直接创建。上游有漂移导致冲突时用 `git apply --3way`；每条补丁都是从源工作树整-树导出，并用 `git apply --check --reverse` 反向校验过。

## 3. 接线 profile / Wire the profile

在目标 profile（如 `~/.dsh/profiles/web`）的 `package.json` 依赖里加：

```jsonc
{
  "@deepseek-ai/dsh-api-bot-controller": "link:<abs>/packages/api/bot-controller",
  "@deepseek-ai/dsh-bot": "link:<abs>/packages/bot/bot",
  "@deepseek-ai/dsh-bot-room": "link:<abs>/packages/bot/bot-room",
  "@deepseek-ai/dsh-bot-profile": "link:<abs>/packages/bot/bot-profile",
  "@deepseek-ai/dsh-client-ui-bot": "link:<abs>/packages/client/ui-bot"
  // 同 monorepo 内也可写 workspace:*；发布到 registry 后写版本号
}
```

挂载两点二选一：

- **开关（推荐）**：`06` 补丁已把 `@deepseek-ai/dsh-bot-profile` 加进 `OPTIONAL_BUNDLES`，Web profile 的插件页会出现「Bot Teammates」，打开即挂载下面 4 行；
- **手写**：在 profile 的 cordis 配置里直接 insert（等价于 `bot-profile/cordis.patch.yml`）：

```yaml
- insert:
    - { id: bot,            name: '@deepseek-ai/dsh-bot' }
    - { id: bot-room,       name: '@deepseek-ai/dsh-bot-room' }
    - { id: bot-controller, name: '@deepseek-ai/dsh-api-bot-controller' }
    - { id: ui-bot,         name: '@deepseek-ai/dsh-client-ui-bot' }
```

## 4. 构建与启动 / Build & run

```bash
pnpm install          # 让新增包与 remotes 的新依赖接线
pnpm build            # 完整构建；增量改动至少 pnpm run build:lib
pnpm dsh --profile web --no-open --port 3080
```

冒烟清单：

1. 侧栏出现 **Bots** 面板；创建 Bot（名称、职责、preset、workspace、权限）；
2. 单聊：发消息能收到回复；
3. 群聊：建房间、加成员、@成员 —— 成员各自会话里作答并折返到房间日志；
4. 信息抽屉「权限」下拉钉「完全权限」，让 Bot 写工作区外文件应直接成功、无审批（权限服务在线时）；
5. 打了 `05` 时：Bot 的对话不出现在工作区的会话列表。

## 5. 兼容性与漂移 / Compatibility & drift

- 基线 `0.2.0-rc.1`；上游升级后建议先 `pnpm install && pnpm build` 再逐条 `git apply --3way`。
- 漂移冲突热点：`packages/api/remotes/src/client/index.ts`（remote 装配表）、`packages/api/session-controller/src/client/*`（source map / create 参数）、`packages/client/ui-chat/src/client/presentation-policy.ts`、`packages/client/ui-workspace/src/client/{tree,index}.ts`。
- `06` 后四行别名（`dsh-bot`, `dsh-bot-room`, `dsh-bot-profile`, `dsh-bot/invariant`）位于 tsconfig 生成块的相邻位置，若上游重排该文件，手写别名需随行移动。

## 6. 已知边界 / Known boundaries

- 集成为**软依赖**：`chatTranscript` 面经 `ctx.get(...)?.set()` 可选链访问；`sessionVisibility` 只被本套件 consume（不打 `05` 时上游忽略它，退化为 Bot 会话出现在工作区列表）；`hideModeControls` / `hideContextMeter` 未消费时被上游静默忽略。
- 咨询（`ask_teammate`）的应答路由表在内存：进程重启后未折返的问答会丢回传。
- 群聊不做权限豁免：房间里每个 Bot 走自己会话的权限（钉在 Bot 记录上）。
- Bot 单聊是普通 Session（Host 侧以 Bot 的 preset + workspace 创建），不是独立存储；名册与房间分别落在 `~/.dsh/storages/bot.json`、`bot_room.json`。
