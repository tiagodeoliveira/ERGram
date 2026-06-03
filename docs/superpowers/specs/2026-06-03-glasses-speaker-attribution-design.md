# Speaker attribution + flat chat log on the glasses

**Date:** 2026-06-03
**Status:** Approved design (pending spec review)

## Problem

On the glasses we only attribute *your* speech (`You: …`). Incoming messages from
the topic are rendered with no speaker label, and the data model can't represent
them correctly:

- `renderTurn()` (`main.ts`) shows the reply below a divider with **no name**.
- `onTgMessage()` (`main.ts`) early-returns on `if (!m.bot)` — a **human** replying
  in the topic never appears on the live path; they only surface via history.
- `messagesToTurns()` (`messages.ts`) folds *any* non-bot message into the `user`
  slot, so another person's message renders as **`You:`** — wrong attribution.
- `normalize()` (`client.ts`) captures only `bot: boolean` — never the sender name.

The group is **mixed** (bots *and* multiple humans), so every incoming message needs
correct, per-sender attribution, live.

## Goals

1. Every message on the glasses is attributed to its sender.
2. New messages from **all** senders (humans and bots) appear live in the active topic.
3. Edits (a bot streaming/correcting its message) update in place — for any sender.

## Non-goals

- No avatars/colors (monochrome 576×288, ~10 lines).
- No cross-topic or cross-chat inbox; one topic shown at a time, as today.
- No change to the onboarding wizard, settings, picker, or STT path.

## Design

### 1. Data model: `Turn` → `Msg`

`Turn { user, reply }` is a hardcoded two-party pairing. Replace with a flat,
per-message entry in `src/conversation.ts`:

```ts
export interface Msg {
  id: number    // Telegram message id; local placeholders use negative ids
  from: string  // sender display label ('' when mine — renderer shows 'You')
  text: string
  mine: boolean // sent by the logged-in account
}
```

`histories: Map<number, Turn[]>` becomes `Map<number, Msg[]>`.

**Deleted:** the reply-pairing machine in `main.ts` — `awaitingReply`,
`pendingUserText`, `replyMsgId`, and the `mode: 'thinking'` state. Its sole purpose
was pairing one user message with one bot reply; the flat log makes it obsolete.
After a send, `mode` returns to `idle` and the status to `Ready · <topic>`.

### 2. Sender labeling (pure, testable)

A pure helper with the agreed fallback chain (in `messages.ts`):

```ts
// firstName → '@'+username → (bot ? 'Bot' : 'Someone')
export function senderLabel(s: { firstName?: string; username?: string; bot?: boolean }): string
```

`normalize()` resolves the sender via `message.sender`, falling back to
`await message.getSender()` when entities aren't inlined in the update. (Makes
`normalize` async.)

### 3. Live path: react to everyone, scoped to the active topic

The group-wide subscribe means we must filter by **location**, so `normalize()`
gains two routing fields on `TgMessage`:

- `chatId: string` — the marked chat id (`message.chatId?.toString()`), compared to
  `settings.tgGroupId` (`-100…`) so messages from other chats are ignored.
- `topicId: number` — the forum thread, derived purely as
  `replyTo?.replyToTopId ?? replyTo?.replyToMsgId ?? 1` (1 = General).

`onTgMessage` drops the `if (!m.bot)` guard and instead:

1. Ignores the message unless `m.chatId === settings.tgGroupId` **and**
   `m.topicId === active.topicId`.
2. **Upserts by id** into that topic's log: existing id → update `text`/`from` in
   place (handles edits, for any sender); new id → append.
3. Re-renders if the message landed in the currently shown topic.

`EditedMessage` is already subscribed (`client.ts`), so edit handling falls out of
the upsert for free.

> ⚠️ **Riskiest details — pin down with tests against real GramJS shapes:**
> the `chatId` ↔ `tgGroupId` marked-id comparison, and the `replyTo` →
> `topicId` derivation (Telegram's peer-id marking + forum `replyTo` quirks).

### 4. Optimistic echo of your own send (race-safe)

`TgClient.sendToTopic` returns the sent message id. Sending optimistically appends
a placeholder with a local negative id for instant feedback, then reconciles:

```
const temp = { id: nextLocalId(), from: '', text, mine: true }
log.push(temp); render()
tg.sendToTopic(group, topicId, text)
  .then(realId => {
    // If the subscribe echo already created the real entry, drop the placeholder;
    // otherwise adopt the real id so a later echo upserts onto it.
    log.some(e => e.id === realId) ? removeById(log, temp.id) : (temp.id = realId)
  })
  .catch(() => { temp.text += '  (send failed)'; render() })
```

Correct regardless of whether the send resolution or the self-echo arrives first.
Local ids come from a module-level decrementing counter (always < 0, never collide
with real Telegram ids). When Telegram isn't connected, the message stays a local
placeholder in the log (same as today's offline transcript behavior).

### 5. Rendering

```ts
function renderMsg(m: Msg): string {
  return `${m.mine ? 'You' : m.from}: ${m.text}`
}
```

Compose the doc by walking the log and **grouping consecutive same-speaker
messages**: emit the `Name:` prefix only when the speaker changes from the previous
message, and insert the light `SPEAKER_DIVIDER` rule **only on a speaker change**.
Consecutive messages from one speaker are stacked with a plain newline, no rule,
no repeated name:

```
Alice: hey there
──────────────────
You: what's up
──────────────────
Bob: not much
did you see the PR?
──────────────────
Alice: yeah, looks good
```

The existing heavy `TURN_DIVIDER` is removed; the existing light `SPEAKER_DIVIDER`
is reused as the speaker-change rule. The pinned listening banner and the live
`You: <interim>` transcript line during `listening` are unchanged. Same-speaker
grouping is keyed by `mine` plus `from` (so two different people named the same
still group only when they're actually the same `from` string — acceptable).

The on-glasses scrollback budget (`HISTORY_CHAR_BUDGET`) trim is retained, recomputed
over `from.length + text.length`.

### 6. History seeding

`messagesToTurns` → `messagesToLog(msgs: TgMessage[]): Msg[]`: drop empty-text
(service) messages and map each to a `Msg`. No folding/pairing — simpler and pure.

## Components touched

| File | Change |
|---|---|
| `src/conversation.ts` | `Turn` → `Msg` |
| `src/telegram/messages.ts` | `TgMessage` gains `from`/`chatId`/`topicId`; add `senderLabel`, `topicIdOf`; `messagesToTurns` → `messagesToLog` |
| `src/telegram/client.ts` | `normalize` resolves sender + routing (async, `getSender` fallback); `sendToTopic` returns id |
| `src/main.ts` | `histories` of `Msg[]`; new live path (filter+upsert); optimistic echo+reconcile; new renderer (grouping + speaker-change rule); delete reply-pairing machine and `thinking` mode |
| `package.json` | add Vitest dev dep + `test` script |
| `vitest.config.ts` (new) | minimal config |
| `src/**/*.test.ts` (new) | tests (below) |

## Testing (Vitest)

New harness. Cover the pure logic that now carries the correctness:

- `senderLabel` — firstName preferred; `@username` fallback; `Bot`/`Someone` when
  neither; bot vs human generic.
- `messagesToLog` — drops empty text; preserves order, `from`, `mine`, `id`.
- `topicIdOf` — `replyToTopId` wins; `replyToMsgId` fallback; General → 1.
- upsert/reconcile (extracted as a pure helper over `Msg[]`) — append new id;
  update existing id in place; optimistic placeholder adopts real id; echo-first
  then resolve drops the placeholder (no duplicate).

`pnpm build` (tsc + vite) and `pnpm test` must pass before completion.

## Risks

- **Forum routing fields** (chatId/topicId) are the most failure-prone; tests +
  one live check on a real topic before merge.
- Making `normalize` async ripples into `getTopicHistory`/`subscribe`; both already
  live in async contexts, so contained.
