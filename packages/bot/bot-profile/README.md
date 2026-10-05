---
description: "Add the durable Bot roster, per-Bot chats, group chats, and task handoff from the plugin manager."
kind: "package-bundle"
---

# @deepseek-ai/dsh-bot-profile

English | [中文](README.zh.md)

## Summary

This optional bundle inserts the four Bot rows the shipped Web composition leaves out: `bot`, `bot-room`, `bot-controller`, and `ui-bot`. Shipped profiles leave it switched off.

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

Open Plugins in the Web sidebar and enable Bots. The sidebar gains the Bots panel: a durable roster of named teammates, each holding a job description, a preset, a home workspace, an optional avatar, and one continuing chat that reopens instead of starting over. Several Bots can form a group chat whose messages are delivered into each member's own conversation, and a Bot can hand one task to another Bot with `handoff_to_bot`. Disabling the bundle removes the panel and its Remote namespace; every Bot record, room log, and conversation stays on disk and returns when the bundle is enabled again.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer details — click to expand</summary>

`cordis.patch.yml` inserts the four rows, and `package.json` depends on their packages so each row resolves from this bundle. `OPTIONAL_BUNDLES` in `packages/boot/app-boot/src/profile.ts` names this package and `apps/cli` depends on it, so every installation ships it switched off and the plugin manager offers it in the Official group. Selecting it appends the bundle to the profile's `dsh.profile.bundles` list. No runtime invariant companion is published because this configuration-only package owns no mutable runtime state.

| File | Role |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | Inserts the `bot`, `bot-room`, `bot-controller`, and `ui-bot` rows |
| [`package.json`](package.json) | The row packages as dependencies |
| [`locale/en.json`](locale/en.json), [`locale/zh.json`](locale/zh.json) | Plugin-manager title and description |
| [`icon.svg`](icon.svg) | Plugin-manager icon |
| [`src/index.ts`](src/index.ts) | Empty module entry; the patch is the runtime content |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Bot registry](../../bot/bot/README.md) — durable records, the roster, and each Bot's continuing conversation.
- [Bot rooms](../../bot/bot-room/README.md) — group-chat records, their message log, and delivery.
- [Web bundle](../../bundle/web-app/README.md) — the composition this bundle adds the rows to.

-----

<a id="model-experience"></a>
## Model Experience

### Bot identity, handoff, and room frames

#### What the model sees

In a Bot's own conversation, the Agent composes with the Bot's persona — its name, standing job, and a bounded roster of its teammates in place of the deployment persona — and gains three tools: `handoff_to_bot`, which delivers one task into another Bot's conversation and wakes it there; `list_bots`, which lists the teammates with fuller descriptions; and `ask_teammate`, which asks a teammate one question and gets the captured answer back as a new message. A room message reaches a member as one framed user message carrying the room name, its members, the newest log lines, and the delivered text; a reply whose first token is `[skip]` stays out of the room log.

#### Token effect

The persona, roster block, and all three tool schemas sit in the request prefix of that Bot's conversations; the roster block carries at most 12 teammates with 200-character descriptions. Each delivered room frame is bounded at 4,000 characters and carries at most the newest ten log lines, each truncated to 280 characters; the full room log never enters a request.

#### KV Cache effect

Persona and tool changes alter the request prefix when a Bot conversation composes. Delivered frames append after the prefix, so existing entries are not invalidated.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- While the bundle is on, its page offers a switch per row as for every bundle. The four rows work only together: switching `bot-controller` off leaves the panel without its Remote namespace, and switching `ui-bot` off leaves the service without its panel.
- A profile patch or `--patch` overlay that targets `bot`, `bot-room`, `bot-controller`, or `ui-bot` by id matches no row while this bundle is not selected: the loader warns `patch: entry <id> not found` for each such patch. Select this bundle instead of switching the rows on by id.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer details — click to expand</summary>

None.

</details>
