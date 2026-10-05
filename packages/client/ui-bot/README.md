---
description: "Bot roster page and creation flow for the DeepSeek Harness Web client."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-bot

English | [中文](README.zh.md)

## Summary

Use this package to give the Web client its Bots panel: the conversation rail, the roster with its creation form, one continuing chat per Bot, group-chat panes, and the info drawer that edits a Bot's name, job, avatar, and pinned permission. A Bot chat is an ordinary Session rendered inside the panel: its resource resolves the Host's continuing conversation, and the roster publishes those Sessions through the session-visibility face so the Workspace browser leaves them out. Choose it when the product shows Bot teammates; browser-only, it needs the Host Bot namespace and renders nothing without it.

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

Open Bots in the Web sidebar. The panel keeps the roster and creation form on its home view, opens one continuing chat per Bot, and opens group chats whose members are the roster's Bots. The info drawer edits the selected Bot — name, job, avatar, and the permission preset its conversations run under (the deployment default unless pinned).

### When to use it

Use it when the product shows Bot teammates in the browser. Skip it for Host-only or headless compositions; the panel is the only entry point it adds.

### The Bot chat resource

A Bot chat is an ordinary Session rendered inside the panel. The resource provider resolves `dsh-resource://botchat/bot/<id>` through the Host's `ensureConversation`, retains the returned Session for as long as the chat is open, and quiets that Session's work-console chrome — reasoning rows, the turn-process label, the usage pill, and the session statistics. The roster also publishes its conversations through the session-visibility face, so every Workspace browser list leaves them out.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer details — click to expand</summary>

`apply` registers the `bots` main panel (with the session-scoped `bot.chat` slot), the `BotConversationPage` occupant, and the sidebar entry, and it provides the chat resource provider and the session-visibility face. The panel's injected face wires `ctx.botsClient` (roster and room state), the workspace list, and the permission catalog through `ctx.remote.permissionPresets.catalog()`, whose configured options feed the drawer's permission control. Icons, the `bot.roster` locale dictionaries, and CSS ship with the package. No runtime invariant companion is published because this browser package owns no host-side state.

</details>

Source: [`packages/client/ui-bot/src/client/index.ts`](./src/client/index.ts)

-----

<a id="further-exploration"></a>
## Further Exploration

- [`@deepseek-ai/dsh-bot`](../../bot/bot/README.md) — the roster and each Bot's continuing conversation.
- [`@deepseek-ai/dsh-api-bot-controller`](../../api/bot-controller/README.md) — the Remote namespace this panel consumes.
- [`@deepseek-ai/dsh-api-remotes`](../../api/remotes/README.md) — the client assembly that mounts that namespace.

-----

<a id="model-experience"></a>
## Model Experience

None, as this package renders host-observed Bot state for a human and touches no prompt, message, schema, stream, or tool result.

#### KV Cache effect

None; the package never assembles or sends provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Host-projected state** — the panel renders what the Bot namespace projects. Records, rooms, and conversations live in the Host profile, and disabling the bundle removes the surface while everything stays on disk.
- **Configured presets only** — the drawer pins presets the deployment advertises; the experimental current-session Auto preset is not a durable Bot setting.
- **One conversation per Bot** — every open resumes the same Session, so the panel cannot run two independent chats with one Bot.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer details — click to expand</summary>

The panel is part of the Bots bundle (`@deepseek-ai/dsh-bot-profile`); it renders only when that bundle is selected and the Host composes the Bot namespace. Browser-visible copy lives in `src/client/locales.ts` and must stay complete across both languages.

</details>
