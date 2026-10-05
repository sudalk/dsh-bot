---
description: "Bot entity registry (ctx.bots) for hosts choosing, mounting, or debugging durable named AI teammates with a preset, a workspace home, and a roster order."
kind: "package-reference"
---

# @deepseek-ai/dsh-bot

English | [中文](README.zh.md)

## Summary

Use this package to keep a durable roster of named AI teammates. A Bot carries the profile that shapes every conversation it holds — display name, rule-bearing description, the agent preset its Sessions compose from, its home workspace, and an optional pinned permission — plus a manually ordered roster position. It is the identity layer over the existing session model: a Bot conversation is an ordinary Session, and this package owns only the durable record deciding its composition. Choose it when the product shows a teammate roster; Host-only, it needs the storage rows and fails loud on unowned workspaces.

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

Use this package to give the product a teammate roster: named Bots that outlive any single conversation, keep a standing job description, and always compose from the same preset and workspace.

### When to use it

Use it when the product shows a persistent teammate surface and a conversation must inherit a durable identity. Skip it when every conversation is anonymous; nothing else in the harness needs it.

### Setting up

The package needs the storage rows that keep its records. A minimal composition:

```yaml
- name: '@deepseek-ai/dsh-storage'
- name: '@deepseek-ai/dsh-storage-json'
- name: '@deepseek-ai/dsh-storage-domain'
  config:
    backend: json
- name: '@deepseek-ai/dsh-bot'
```

The registry opens its domain and validates the stored roster order at startup. A composition that also mounts `@deepseek-ai/dsh-workspace` can name a workspace when creating a Bot; without it, every create fails loud rather than pointing at a directory the product does not track.

### Creating and updating Bots

Creating a Bot validates the whole profile before any write, then persists the record and prepends its id to the durable roster order:

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

Names and descriptions are trimmed, non-blank, and bounded (`BOT_NAME_MAX_CHARS`, `BOT_DESCRIPTION_MAX_CHARS`). `validateBotProfile` exposes the same checks for a form that must preflight without writing.

### Pinning a conversation's permission

A Bot may pin the permission preset every conversation with it runs under, so a teammate the user armed — full file access without approval prompts — stays armed across restarts instead of quietly falling back to the deployment default. The pin is a preset name on the record, applied to the Session of each Agent composed for the Bot and re-applied immediately when the profile changes; clearing it with the empty string returns the live conversation to the deployment default.

The pin rides the deployment's permission service, so a composition without `@deepseek-ai/dsh-permission-presets` records it and applies the deployment default, and a preset the deployment does not offer is reported instead of failing composition.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

`BotRegistry` (`ctx.bots`) owns the durable records, the roster order, and the entity cache. `BotEntity` is the package-private implementation behind the `Bot` interface; every mutation funnels through one write path that stamps `updatedAt`, and a no-op update neither rewrites the medium nor emits a change event.

The domain spec (`botDomainSpec`) declares one `bots` table keyed by `BotId` plus a global holding `botIds`. The spec object is the single source of the domain's identity, version, and record schemas. Records are validated at the durability boundary by zod; consumers never touch the backend.

Startup validates the stored roster against the table and fails loud on unexplained divergence: a repeated order entry, an order entry whose record is missing, or a record absent from the order all reject the open instead of silently repairing an impossible state. Create writes the record before the order entry and rolls the record back when the order write fails.

The optional invariant companion (`@deepseek-ai/dsh-bot/invariant`) asserts the owned relationship between the registry cache and the `bots` table, in both directions.

Source: [`packages/bot/bot/src/index.ts`](./src/index.ts)

-----

<a id="further-exploration"></a>
## Further Exploration

- [`@deepseek-ai/dsh-workspace`](../../workspace/workspace/README.md) owns the directories a Bot can call home.
- [`@deepseek-ai/dsh-storage-domain`](../../storage/storage-domain/README.md) owns the domain data form this registry opens.
- [`@deepseek-ai/dsh-preset`](../../preset/agent-preset/README.md) owns the presets a Bot names.

-----

<a id="model-experience"></a>
## Model Experience

### Bot identity and task handoff

#### What the model sees

An Agent composed for a Bot's continuing conversation carries that Bot's persona — its name and standing role, installed on the Agent's own scope so it shadows the deployment persona for that Session only — a bounded roster block naming the other Bots and their jobs, and three tools: `handoff_to_bot`, which delivers one bounded task into another Bot's conversation and wakes it there; `list_bots`, which answers the same roster question on demand with fuller descriptions; and `ask_teammate`, which asks a teammate one question and routes the captured answer back as a new message that wakes the asker. Every other Session keeps the deployment prompt and gains none of this.

#### Token effect

The persona text, the roster block, and all three tool schemas sit in the request prefix of every turn in that Bot's conversation. The roster block carries at most 12 teammates, each description bounded at 200 characters; `list_bots` answers with every teammate, each description bounded at 500 characters. One handoff task is bounded at 8,000 characters, and a chain may cross at most 3 handoffs before the tool refuses and tells the receiving Bot to finish the work itself. One consultation question is bounded at 4,000 characters and its captured answer at 8,000; a consult chain may run at most 3 rounds before the asking Bot must continue on its own.

#### KV Cache effect

Composing a Bot conversation changes the request prefix relative to an ordinary Session, and within the conversation the prefix is stable. Handoff deliveries arrive as ordinary user messages after the prefix, so they append without invalidating existing entries.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- A Bot record does not own its conversations. Linking a Bot to the Sessions created with its preset and workspace, and exposing the profile to the model, are consumer responsibilities that this registry deliberately leaves out.
- Deleting a Bot removes only its own record and roster slot. Cascading to routines, rooms, or running work is not implemented here; callers own those consequences until those domains exist.
- Memory, skill selection, and MCP connector selection are not part of the record yet. The profile carries only the fields the identity layer needs today.
- The roster order is a single flat list. Pinning, grouping, and per-user ordering are not modeled.

-----

<a id="dev-note"></a>
### Dev Note

The domain spec lives in `src/spec.ts` and is the only place the durable format is declared. Record changes need their own persistence acknowledgement; see [docs/cookbook/reviewing-persistence-type-changes.md](../../../docs/cookbook/reviewing-persistence-type-changes.md).
