# dsh-bot

[deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 的 **Bot Teammates** 插件套件：持久的 Bot 队友名册——单聊 / 群聊、按 Bot 固定的权限、队友间任务交接（handoff）、名册感知（`list_bots`）与异步咨询（`ask_teammate`）。

*Bot Teammates plugin suite for deepseek-harness: a durable roster of named AI teammates — one-to-one chats and group chats, per-Bot permission pinning, task handoff, roster awareness, and asynchronous consultation.*

## 包含的包 / Packages

| 包 | 职责 |
|---|---|
| [`packages/bot/bot`](packages/bot/bot/README.md) | Bot 记录、名册顺序、持续会话；persona/名册工具、`handoff_to_bot`、`ask_teammate`。 |
| [`packages/bot/bot-room`](packages/bot/bot-room/README.md) | 名册之上的群聊：房间、只追加日志、向成员会话的投递。 |
| [`packages/bot/bot-profile`](packages/bot/bot-profile/README.md) | Bundle：把整套插件挂进 deepseek-harness profile（插件页一个开关）。 |
| [`packages/api/bot-controller`](packages/api/bot-controller/README.md) | 把名册与房间暴露给浏览器端的 Remote 命名空间。 |
| [`packages/client/ui-bot`](packages/client/ui-bot/README.md) | 浏览器面板：名册页、单聊、群聊、信息抽屉（名称/职责/头像/权限）。 |

每个包的 README 有各自的使用说明、Model Experience 与已知边界（中英双语）。

## 安装 / Install

本仓库不能独立安装：5 个包以 `workspace:*` 依赖 harness 核心包，需集成进 deepseek-harness 检出（基线 `0.2.0-rc.1`）。完整步骤——放入包、按域拆分的 7 张补丁（3 张必打 / 4 张可选，各自标注缺失后果）、profile 接线、构建验证与已知边界——见 [INSTALL.md](INSTALL.md)，补丁本体在 [`patches/`](patches/)。

*Not independently installable: integrate into a deepseek-harness checkout. See [INSTALL.md](INSTALL.md) for the domain-split patch set (3 required / 4 optional), profile wiring, and verification steps.*

## 状态 / Status

从 deepseek-harness 工作区抽出（版本 `0.2.0-rc.1`），目录结构保持与其 monorepo 一致；各包以 `workspace:*` 声明对 harness 核心包的依赖，因此用于在 deepseek-harness 检出中构建与运行，暂不独立成构建单元。

*Extracted from a deepseek-harness working tree (v0.2.0-rc.1); keeps the monorepo layout and declares core dependencies as `workspace:*`, so it builds and runs inside a deepseek-harness checkout.*
