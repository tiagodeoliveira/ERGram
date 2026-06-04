# Glasses Speaker Attribution + Flat Chat Log Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Attribute every message on the glasses to its sender and show new messages from all senders (humans and bots) live, by replacing the two-party `Turn` model with a flat attributed chat log.

**Architecture:** Replace `Turn { user, reply }` with a flat `Msg { id, from, text, mine }` list per topic. Telegram messages are normalized with a sender label + routing fields (`chatId`, `topicId`); the live handler reacts to all senders scoped to the active topic and upserts by id (so edits update in place). Your own sends echo optimistically with a negative local id and reconcile against the real id. Rendering groups consecutive same-speaker messages and separates speaker changes with a light rule. The old reply-pairing machine and `thinking` mode are deleted.

**Tech Stack:** TypeScript, Vite, GramJS (`telegram`), `@evenrealities/even_hub_sdk`, `@evenrealities/pretext`; **Vitest** (new) for unit tests.

**Spec:** `docs/superpowers/specs/2026-06-03-glasses-speaker-attribution-design.md`

**Verification note:** Tasks 2–6 add/modify pure modules and verify with `pnpm test` (Vitest transpiles with esbuild, so unrelated cross-file type errors do not block them). The full TypeScript typecheck + build gate (`pnpm build`) runs once at Task 8, after `client.ts` and `main.ts` are both updated. Do not expect `pnpm build` to pass between Tasks 4 and 8.

---

## File structure

| File                                         | Responsibility                                                                                                               |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `src/conversation.ts` (modify)               | `Msg` type + pure log ops: `upsertMsg`, `removeById`, `reconcileSend`                                                        |
| `src/telegram/messages.ts` (modify)          | `TgMessage` (+`from`/`chatId`/`topicId`); pure helpers `senderLabel`, `topicIdOf`, `messagesToLog`                           |
| `src/glasses/render.ts` (create)             | Pure `renderConversation(msgs, divider)` — grouping + speaker-change rule                                                    |
| `src/telegram/client.ts` (modify)            | `normalize` resolves sender + routing (async); `sendToTopic` returns the sent id                                             |
| `src/main.ts` (modify)                       | Flat-log state, live path (filter+upsert), optimistic echo+reconcile, new renderer; delete pairing machine + `thinking` mode |
| `vitest.config.ts` (create)                  | Minimal Vitest config                                                                                                        |
| `package.json` (modify)                      | Vitest dev dep + `test` scripts                                                                                              |
| `src/*.test.ts`, `src/**/*.test.ts` (create) | Unit tests for the pure modules                                                                                              |

---

## Task 1: Set up Vitest

**Files:**

- Modify: `package.json`
- Create: `vitest.config.ts`

- [ ] **Step 1: Add Vitest as a dev dependency**

Run:

```bash
pnpm add -D vitest@^2.1.8
```

- [ ] **Step 2: Add test scripts to `package.json`**

In the `"scripts"` block of `package.json`, add these two entries (leave the existing scripts intact):

```json
    "test": "vitest run",
    "test:watch": "vitest"
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

// Separate from vite.config.ts so the app's node-polyfill plugin doesn't load
// under the unit tests (the pure helpers need no browser/Node shims).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
```

- [ ] **Step 4: Verify the harness runs with no tests yet**

Run: `pnpm exec vitest run --passWithNoTests`
Expected: exits 0, prints `No test files found` (acceptable — the next task adds the first test).

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml vitest.config.ts
git commit -m "Add Vitest harness"
```

---

## Task 2: `senderLabel` helper

**Files:**

- Modify: `src/telegram/messages.ts`
- Test: `src/telegram/messages.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/telegram/messages.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { senderLabel } from './messages'

describe('senderLabel', () => {
  it('prefers a non-empty first name', () => {
    expect(senderLabel({ firstName: 'Alice', username: 'al', bot: false })).toBe('Alice')
  })
  it('falls back to @username when first name is blank', () => {
    expect(senderLabel({ firstName: '   ', username: 'al' })).toBe('@al')
  })
  it('uses @username when there is no first name', () => {
    expect(senderLabel({ username: 'bob' })).toBe('@bob')
  })
  it('labels bots with no name/username as Bot', () => {
    expect(senderLabel({ bot: true })).toBe('Bot')
  })
  it('labels unknown humans as Someone', () => {
    expect(senderLabel({})).toBe('Someone')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- src/telegram/messages.test.ts`
Expected: FAIL — `senderLabel` is not exported from `./messages`.

- [ ] **Step 3: Implement `senderLabel`**

Add to the top of `src/telegram/messages.ts` (below the existing imports):

```ts
// Resolve a display label for a message sender: first name → @username →
// generic ('Bot' for bots, 'Someone' otherwise). Accepts a minimal shape so it
// stays pure and testable independent of GramJS entity types.
export function senderLabel(s: { firstName?: string; username?: string; bot?: boolean }): string {
  const first = s.firstName?.trim()
  if (first) return first
  const user = s.username?.trim()
  if (user) return '@' + user
  return s.bot ? 'Bot' : 'Someone'
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- src/telegram/messages.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/telegram/messages.ts src/telegram/messages.test.ts
git commit -m "Add senderLabel helper"
```

---

## Task 3: `topicIdOf` helper

**Files:**

- Modify: `src/telegram/messages.ts`
- Test: `src/telegram/messages.test.ts`

- [ ] **Step 1: Add the failing test**

Append to `src/telegram/messages.test.ts` (add `topicIdOf` to the existing import from `./messages`):

```ts
import { senderLabel, topicIdOf } from './messages'

describe('topicIdOf', () => {
  it('prefers replyToTopId (reply within a topic)', () => {
    expect(topicIdOf({ replyToTopId: 55, replyToMsgId: 10 })).toBe(55)
  })
  it('falls back to replyToMsgId (top-level message in a topic)', () => {
    expect(topicIdOf({ replyToMsgId: 10 })).toBe(10)
  })
  it('treats a missing reply header as the General topic (1)', () => {
    expect(topicIdOf(undefined)).toBe(1)
    expect(topicIdOf({})).toBe(1)
  })
})
```

> Note: keep a single `import { ... } from './messages'` line — merge `topicIdOf` into the import added in Task 2 rather than duplicating it.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- src/telegram/messages.test.ts`
Expected: FAIL — `topicIdOf` is not exported.

- [ ] **Step 3: Implement `topicIdOf`**

Add to `src/telegram/messages.ts`:

```ts
// Forum thread id for a message. Telegram puts the topic root in replyToTopId
// for replies inside a topic, in replyToMsgId for the topic's top-level posts,
// and omits the header entirely for the General topic (id 1).
export function topicIdOf(replyTo?: { replyToTopId?: number; replyToMsgId?: number }): number {
  return replyTo?.replyToTopId ?? replyTo?.replyToMsgId ?? 1
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- src/telegram/messages.test.ts`
Expected: PASS (8 tests total).

- [ ] **Step 5: Commit**

```bash
git add src/telegram/messages.ts src/telegram/messages.test.ts
git commit -m "Add topicIdOf helper"
```

---

## Task 4: `Msg` type + pure log operations

**Files:**

- Modify: `src/conversation.ts`
- Test: `src/conversation.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/conversation.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { upsertMsg, removeById, reconcileSend, type Msg } from './conversation'

const msg = (id: number, text: string, from = '', mine = false): Msg => ({ id, from, text, mine })

describe('upsertMsg', () => {
  it('appends a message with a new id', () => {
    const log: Msg[] = []
    upsertMsg(log, msg(1, 'hi'))
    expect(log).toEqual([msg(1, 'hi')])
  })
  it('updates an existing id in place (edit)', () => {
    const log: Msg[] = [msg(1, 'old', 'Alice')]
    upsertMsg(log, msg(1, 'new', 'Alice'))
    expect(log).toEqual([msg(1, 'new', 'Alice')])
    expect(log.length).toBe(1)
  })
})

describe('removeById', () => {
  it('removes the matching entry, leaving others', () => {
    const log: Msg[] = [msg(1, 'a'), msg(2, 'b')]
    removeById(log, 1)
    expect(log).toEqual([msg(2, 'b')])
  })
  it('is a no-op when the id is absent', () => {
    const log: Msg[] = [msg(2, 'b')]
    removeById(log, 99)
    expect(log).toEqual([msg(2, 'b')])
  })
})

describe('reconcileSend', () => {
  it('adopts the real id when no echo arrived yet (resolve-first)', () => {
    const log: Msg[] = [msg(-1, 'sent', '', true)]
    reconcileSend(log, -1, 100)
    expect(log).toEqual([msg(100, 'sent', '', true)])
  })
  it('drops the placeholder when the echo already created the real entry (echo-first)', () => {
    const log: Msg[] = [msg(100, 'sent', '', true), msg(-1, 'sent', '', true)]
    reconcileSend(log, -1, 100)
    expect(log).toEqual([msg(100, 'sent', '', true)])
  })
  it('is a no-op when the placeholder is gone', () => {
    const log: Msg[] = [msg(100, 'sent', '', true)]
    reconcileSend(log, -1, 100)
    expect(log).toEqual([msg(100, 'sent', '', true)])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- src/conversation.test.ts`
Expected: FAIL — `upsertMsg`/`removeById`/`reconcileSend`/`Msg` not exported.

- [ ] **Step 3: Replace `src/conversation.ts`**

Replace the entire file contents:

```ts
// One message in a topic's flat, attributed chat log.
export interface Msg {
  id: number // Telegram message id (>0); optimistic local placeholders use <0
  from: string // sender display label ('' when mine — the renderer shows 'You')
  text: string
  mine: boolean // sent by the logged-in account
}

// Insert by id, or update text/from/mine in place if the id already exists.
// In-place update is how message edits (e.g. a bot streaming a reply) are applied.
export function upsertMsg(log: Msg[], msg: Msg): void {
  const existing = log.find((m) => m.id === msg.id)
  if (existing) {
    existing.text = msg.text
    existing.from = msg.from
    existing.mine = msg.mine
  } else {
    log.push(msg)
  }
}

export function removeById(log: Msg[], id: number): void {
  const i = log.findIndex((m) => m.id === id)
  if (i >= 0) log.splice(i, 1)
}

// Reconcile an optimistic send: `tempId` is the placeholder's local id, `realId`
// is the id Telegram assigned. If the subscribe echo already created the real
// entry, drop the placeholder; otherwise the placeholder adopts the real id so a
// later echo upserts onto it. Safe regardless of which arrives first.
export function reconcileSend(log: Msg[], tempId: number, realId: number): void {
  const temp = log.find((m) => m.id === tempId)
  if (!temp) return
  if (log.some((m) => m.id === realId && m !== temp)) {
    removeById(log, tempId)
  } else {
    temp.id = realId
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- src/conversation.test.ts`
Expected: PASS (7 tests). (`pnpm build` will NOT pass yet — `Turn` is gone; fixed by Task 8.)

- [ ] **Step 5: Commit**

```bash
git add src/conversation.ts src/conversation.test.ts
git commit -m "Replace Turn with flat Msg log + pure log ops"
```

---

## Task 5: `messagesToLog` + `TgMessage` fields

**Files:**

- Modify: `src/telegram/messages.ts`
- Test: `src/telegram/messages.test.ts`

- [ ] **Step 1: Add the failing test**

Append to `src/telegram/messages.test.ts` (merge `messagesToLog` and the `TgMessage` type into the existing `./messages` import):

```ts
import { senderLabel, topicIdOf, messagesToLog, type TgMessage } from './messages'

describe('messagesToLog', () => {
  const tg = (over: Partial<TgMessage>): TgMessage => ({
    id: 0,
    text: '',
    mine: false,
    bot: false,
    from: '',
    chatId: '-100',
    topicId: 5,
    date: 0,
    ...over,
  })

  it('drops empty/whitespace (service) messages and trims text', () => {
    const out = messagesToLog([
      tg({ id: 1, text: 'hi', from: 'Alice' }),
      tg({ id: 2, text: '   ' }),
      tg({ id: 3, text: ' yo ', mine: true, from: '' }),
    ])
    expect(out).toEqual([
      { id: 1, from: 'Alice', text: 'hi', mine: false },
      { id: 3, from: '', text: 'yo', mine: true },
    ])
  })

  it('preserves order', () => {
    const out = messagesToLog([
      tg({ id: 1, text: 'a', from: 'A' }),
      tg({ id: 2, text: 'b', from: 'B' }),
    ])
    expect(out.map((m) => m.id)).toEqual([1, 2])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- src/telegram/messages.test.ts`
Expected: FAIL — `messagesToLog` not exported / `TgMessage` missing new fields.

- [ ] **Step 3: Update `src/telegram/messages.ts`**

Replace the `TgMessage` interface and the `messagesToTurns` function. The new file (keeping `senderLabel` and `topicIdOf` from Tasks 2–3) is:

```ts
import type { Msg } from '../conversation'

// A normalized Telegram message for rendering.
export interface TgMessage {
  id: number
  text: string
  mine: boolean // sent by the logged-in account (you / the glasses)
  bot: boolean // sent by a bot
  from: string // sender display label (see senderLabel); '' when mine
  chatId: string // marked chat id, e.g. "-1001234567890" (for routing)
  topicId: number // forum thread id (for routing)
  date: number
}

// Resolve a display label for a message sender: first name → @username →
// generic ('Bot' for bots, 'Someone' otherwise). Accepts a minimal shape so it
// stays pure and testable independent of GramJS entity types.
export function senderLabel(s: { firstName?: string; username?: string; bot?: boolean }): string {
  const first = s.firstName?.trim()
  if (first) return first
  const user = s.username?.trim()
  if (user) return '@' + user
  return s.bot ? 'Bot' : 'Someone'
}

// Forum thread id for a message. Telegram puts the topic root in replyToTopId
// for replies inside a topic, in replyToMsgId for the topic's top-level posts,
// and omits the header entirely for the General topic (id 1).
export function topicIdOf(replyTo?: { replyToTopId?: number; replyToMsgId?: number }): number {
  return replyTo?.replyToTopId ?? replyTo?.replyToMsgId ?? 1
}

// Map a chronological message list to the flat log, dropping empty (service)
// messages and trimming text. No turn-pairing — each message is its own entry.
export function messagesToLog(msgs: TgMessage[]): Msg[] {
  const log: Msg[] = []
  for (const m of msgs) {
    const text = (m.text || '').trim()
    if (!text) continue
    log.push({ id: m.id, from: m.from, text, mine: m.mine })
  }
  return log
}
```

> This removes the old `messagesToTurns` and its `Turn` import. `main.ts` still references `messagesToTurns` until Task 8 — that's expected; `pnpm build` is gated at Task 8.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- src/telegram/messages.test.ts`
Expected: PASS (10 tests total).

- [ ] **Step 5: Commit**

```bash
git add src/telegram/messages.ts src/telegram/messages.test.ts
git commit -m "Add messagesToLog + routing fields on TgMessage"
```

---

## Task 6: `renderConversation` (flat log → display string)

**Files:**

- Create: `src/glasses/render.ts`
- Test: `src/glasses/render.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/glasses/render.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { renderConversation } from './render'
import type { Msg } from '../conversation'

const D = '----------' // stand-in divider (real code passes the light rule)
const m = (from: string, text: string, mine = false): Msg => ({ id: 0, from, text, mine })

describe('renderConversation', () => {
  it('returns empty string for an empty log', () => {
    expect(renderConversation([], D)).toBe('')
  })

  it('labels mine as "You" and others by their from label', () => {
    expect(renderConversation([m('Alice', 'hey'), m('', "what's up", true)], D)).toBe(
      ['Alice: hey', D, "You: what's up"].join('\n'),
    )
  })

  it('groups consecutive same-speaker messages under one name, no rule between', () => {
    const out = renderConversation(
      [
        m('Alice', 'hey there'),
        m('', "what's up", true),
        m('Bob', 'not much'),
        m('Bob', 'did you see the PR?'),
        m('Alice', 'yeah, looks good'),
      ],
      D,
    )
    expect(out).toBe(
      [
        'Alice: hey there',
        D,
        "You: what's up",
        D,
        'Bob: not much',
        'did you see the PR?',
        D,
        'Alice: yeah, looks good',
      ].join('\n'),
    )
  })

  it('groups consecutive mine messages too', () => {
    expect(renderConversation([m('', 'one', true), m('', 'two', true)], D)).toBe(
      ['You: one', 'two'].join('\n'),
    )
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- src/glasses/render.test.ts`
Expected: FAIL — `./render` does not exist.

- [ ] **Step 3: Implement `src/glasses/render.ts`**

```ts
import type { Msg } from '../conversation'

// Render the flat log to a display document. Consecutive messages from the same
// speaker are grouped under a single "Name:" prefix (their following lines carry
// no name); a speaker change inserts the `divider` rule between groups. `mine`
// renders as "You". Returns '' for an empty log (caller supplies an idle hint).
export function renderConversation(msgs: Msg[], divider: string): string {
  const groups: string[][] = []
  let prevKey: string | null = null
  for (const m of msgs) {
    const key = m.mine ? '\x00me' : m.from
    const label = m.mine ? 'You' : m.from
    if (key === prevKey && groups.length) {
      groups[groups.length - 1].push(m.text)
    } else {
      groups.push([`${label}: ${m.text}`])
      prevKey = key
    }
  }
  return groups.map((g) => g.join('\n')).join(`\n${divider}\n`)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- src/glasses/render.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/glasses/render.ts src/glasses/render.test.ts
git commit -m "Add renderConversation: grouped, speaker-attributed log"
```

---

## Task 7: Telegram client — sender + routing in `normalize`, id from `sendToTopic`

**Files:**

- Modify: `src/telegram/client.ts`

> No standalone build gate for this task (it compiles together with `main.ts` at Task 8). Apply the exact edits below.

- [ ] **Step 1: Import the pure helpers**

In `src/telegram/client.ts`, update the messages import (it currently imports only the type):

Replace:

```ts
import type { TgMessage } from './messages'
```

with:

```ts
import { senderLabel, topicIdOf, type TgMessage } from './messages'
```

- [ ] **Step 2: Make `sendToTopic` return the sent message id**

Replace the existing `sendToTopic` method:

```ts
  /** Send text into a forum topic (or the chat if threadId is undefined). Returns the sent message id. */
  async sendToTopic(chatId: string, threadId: number | undefined, text: string): Promise<number> {
    const opts: Record<string, unknown> = { message: text }
    if (threadId) opts.replyTo = threadId
    const sent = await this.client.sendMessage(chatId, opts)
    return (sent as unknown as { id: number }).id
  }
```

- [ ] **Step 3: Make `normalize` async and resolve sender + routing**

Replace the existing `private normalize(...)` method:

```ts
  private async normalize(m: unknown): Promise<TgMessage> {
    const x = m as {
      id: number
      message?: string
      out?: boolean
      date?: number
      chatId?: { toString(): string }
      sender?: { firstName?: string; username?: string; bot?: boolean }
      getSender?: () => Promise<{ firstName?: string; username?: string; bot?: boolean } | undefined>
      replyTo?: { replyToTopId?: number; replyToMsgId?: number }
    }

    // Prefer the inlined sender; fetch it only when the update didn't carry one.
    let sender = x.sender
    if (!sender && typeof x.getSender === 'function') {
      try {
        sender = await x.getSender()
      } catch {
        sender = undefined
      }
    }

    const mine = Boolean(x.out)
    return {
      id: x.id,
      text: x.message || '',
      mine,
      bot: Boolean(sender?.bot),
      from: mine ? '' : senderLabel(sender ?? {}),
      chatId: x.chatId?.toString() ?? '',
      topicId: topicIdOf(x.replyTo),
      date: x.date || 0,
    }
  }
```

- [ ] **Step 4: Await `normalize` at its three call sites**

In `getTopicHistory`, replace the return:

```ts
const raw = await this.client.getMessages(chatId, opts)
return Promise.all([...raw].reverse().map((m) => this.normalize(m)))
```

In `subscribe`, make both handlers async:

```ts
const newHandler = async (event: NewMessageEvent): Promise<void> => {
  onMessage(await this.normalize(event.message))
}
const editedHandler = async (event: EditedMessageEvent): Promise<void> => {
  onMessage(await this.normalize(event.message))
}
```

- [ ] **Step 5: Sanity check that the file parses**

Run: `pnpm exec tsc --noEmit src/telegram/client.ts 2>&1 | head -5` _(informational only — cross-file errors from `main.ts` are expected until Task 8)_.

- [ ] **Step 6: Commit**

```bash
git add src/telegram/client.ts
git commit -m "Resolve sender + topic routing in normalize; return sent id"
```

---

## Task 8: Wire `main.ts` to the flat log (integration) — full build gate

**Files:**

- Modify: `src/main.ts`

This task makes the whole app compile and run on the new model. Apply each edit, then verify with `pnpm build` + `pnpm test`.

- [ ] **Step 1: Fix imports**

Replace the conversation/messages/ui-related imports near the top of `src/main.ts`.

Replace:

```ts
import { mountUi, setStatus, setTranscript, setReply, flashSaved } from './ui'
```

with:

```ts
import { mountUi, setStatus, setTranscript, flashSaved } from './ui'
```

Replace:

```ts
import { messagesToTurns } from './telegram/messages'
import type { Topic } from './telegram/topics'
import type { Turn } from './conversation'
```

with:

```ts
import { messagesToLog } from './telegram/messages'
import type { Topic } from './telegram/topics'
import { upsertMsg, removeById, reconcileSend, type Msg } from './conversation'
import { renderConversation } from './glasses/render'
```

- [ ] **Step 2: Remove the heavy turn divider and `thinking` mode**

Delete the `TURN_DIVIDER` constant line:

```ts
const TURN_DIVIDER = makeRule('━')
```

Change the `Mode` type:

```ts
type Mode = 'idle' | 'listening'
```

- [ ] **Step 3: Switch topic state to `Msg[]` and add a local id generator**

Replace:

```ts
const histories = new Map<number, Turn[]>()
function historyFor(id: number): Turn[] {
  let h = histories.get(id)
  if (!h) {
    h = []
    histories.set(id, h)
  }
  return h
}

let active: { topicId: number; title: string } | null = null
let history: Turn[] = []
```

with:

```ts
const histories = new Map<number, Msg[]>()
function historyFor(id: number): Msg[] {
  let h = histories.get(id)
  if (!h) {
    h = []
    histories.set(id, h)
  }
  return h
}

let active: { topicId: number; title: string } | null = null
let history: Msg[] = []

// Optimistic placeholders use decreasing negative ids so they never collide
// with real (positive) Telegram message ids.
let localSeq = -1
function nextLocalId(): number {
  return localSeq--
}
```

- [ ] **Step 4: Delete the reply-pairing state block**

Delete this entire block (the "Awaiting-reply tracking" section):

```ts
// ── Awaiting-reply tracking ──
// Simple approach: set awaitingReply=true when we send a message. When a bot
// message arrives, commit the turn (or update the last committed turn if it's
// an edit of the same message id). On the next send we reset and start fresh.
let awaitingReply = false
let pendingUserText = ''
let replyMsgId: number | null = null
```

- [ ] **Step 5: Replace the turn-rendering helpers with the flat-log renderer**

Replace this block:

```ts
// ── Turn rendering ──
function renderTurn(t: Turn): string {
  const head = `You: ${t.user}`
  return t.reply ? `${head}\n${SPEAKER_DIVIDER}\n${t.reply}` : head
}
function renderActive(): string {
  if (replyText || mode === 'thinking') {
    return `You: ${transcriptText}\n${SPEAKER_DIVIDER}\n${replyText || '…'}`
  }
  if (transcriptText) return `You: ${transcriptText}`
  return ''
}
function listeningBody(): string {
  return transcriptText || '(speak now)'
}
function composeDoc(): string {
  const blocks = history.map(renderTurn)
  const activeBlock = renderActive()
  if (activeBlock) blocks.push(activeBlock)
  const doc = blocks.join(`\n${TURN_DIVIDER}\n`)
  return doc || HINT_IDLE
}
// Append a turn to a topic's log and trim it to the budget.
function pushTurn(arr: Turn[], user: string, reply: string): void {
  if (user || reply) arr.push({ user, reply })
  let total = arr.reduce((n, t) => n + t.user.length + t.reply.length + 16, 0)
  while (arr.length > 1 && total > HISTORY_CHAR_BUDGET) {
    const dropped = arr.shift()!
    total -= dropped.user.length + dropped.reply.length + 16
  }
}
```

with:

```ts
// ── Flat-log rendering ──
function listeningBody(): string {
  return transcriptText || '(speak now)'
}
function composeDoc(): string {
  return renderConversation(history, SPEAKER_DIVIDER) || HINT_IDLE
}
// Upsert a message into a topic's log, then trim it to the scrollback budget.
function appendMsg(log: Msg[], msg: Msg): void {
  upsertMsg(log, msg)
  let total = log.reduce((n, m) => n + m.from.length + m.text.length + 16, 0)
  while (log.length > 1 && total > HISTORY_CHAR_BUDGET) {
    const dropped = log.shift()!
    total -= dropped.from.length + dropped.text.length + 16
  }
}
```

- [ ] **Step 6: Update `stopListening` (no Telegram → store a local mine message)**

In `stopListening`, replace the `else` branch of the `if (canChat(settings) && active)`:

Replace:

```ts
  } else {
    pushTurn(history, text, '')
    mode = 'idle'
    setStatus('idle', 'Transcribed · connect Telegram to chat')
    setDoc(composeDoc())
    transcriptText = ''
    replyText = ''
  }
```

with:

```ts
  } else {
    appendMsg(history, { id: nextLocalId(), from: '', text, mine: true })
    mode = 'idle'
    setStatus('idle', 'Transcribed · connect Telegram to chat')
    setDoc(composeDoc())
    transcriptText = ''
    replyText = ''
  }
```

- [ ] **Step 7: Replace `sendTurn` with the optimistic-echo flow**

Replace the entire `sendTurn` function:

```ts
function sendTurn(userText: string): void {
  if (!tg || !active) {
    reflectIdle()
    return
  }
  const topicId = active.topicId
  const target = historyFor(topicId)

  // Optimistic local echo for instant feedback; reconcile against the real id.
  const tempId = nextLocalId()
  appendMsg(target, { id: tempId, from: '', text: userText, mine: true })

  mode = 'idle'
  transcriptText = ''
  replyText = ''
  followTail = true
  setStatus('idle', `Ready · ${active.title}`)
  if (active.topicId === topicId) {
    history = target
    setDoc(composeDoc())
  }

  tg.sendToTopic(settings.tgGroupId, topicId, userText)
    .then((realId: number) => {
      reconcileSend(target, tempId, realId)
      if (active?.topicId === topicId) {
        history = target
        setDoc(composeDoc())
      }
    })
    .catch((err: unknown) => {
      const temp = target.find((m) => m.id === tempId)
      if (temp) temp.text = `${userText}  (send failed)`
      if (active?.topicId === topicId) {
        history = target
        setStatus('error', `Send failed: ${(err as Error)?.message ?? err}`)
        setDoc(composeDoc())
      }
    })
}
```

- [ ] **Step 8: Replace `onTgMessage` with the all-senders, topic-scoped handler**

Replace the entire `onTgMessage` function and its leading comment block:

```ts
// ── Incoming Telegram messages (new + edits from subscribe) ──
// React to every sender (humans and bots), scoped to the active group + topic.
// Upsert by id so edits (e.g. a bot streaming/correcting) update in place. Our
// own outgoing messages also arrive here and upsert onto the reconciled id.
function onTgMessage(m: TgMessage): void {
  if (!active) return
  if (m.chatId !== settings.tgGroupId.trim()) return
  if (m.topicId !== active.topicId) return
  const text = m.text.trim()
  if (!text) return

  const log = historyFor(active.topicId)
  appendMsg(log, { id: m.id, from: m.from, text, mine: m.mine })
  history = log

  if (view === 'convo') {
    mode = 'idle'
    setStatus('idle', `Ready · ${active.title}`)
    setDoc(composeDoc())
  }
}
```

- [ ] **Step 9: Update `switchToTopic` history seeding + reset**

In `switchToTopic`, remove the now-deleted reply-tracking resets and use `messagesToLog`.

Replace:

```ts
mode = 'idle'
transcriptText = ''
replyText = ''
awaitingReply = false
pendingUserText = ''
replyMsgId = null
followTail = true
lineOffset = 0
view = 'convo'
```

with:

```ts
mode = 'idle'
transcriptText = ''
replyText = ''
followTail = true
lineOffset = 0
view = 'convo'
```

And replace:

```ts
history.push(...messagesToTurns(msgs))
```

with:

```ts
history.push(...messagesToLog(msgs))
```

- [ ] **Step 10: Scan for leftover `thinking` / `replyText` references**

Run: `grep -n "thinking\|replyText\|setReply\|pushTurn\|renderTurn\|renderActive\|awaitingReply\|messagesToTurns\|TURN_DIVIDER" src/main.ts`

Expected: only `replyText` declarations/resets remain (the module-level `let replyText = ''` and its `= ''` resets are harmless and still referenced). There must be **no** remaining references to `thinking`, `setReply`, `pushTurn`, `renderTurn`, `renderActive`, `awaitingReply`, `messagesToTurns`, or `TURN_DIVIDER`. If any appear, remove/fix them. (Note: `startListening` still sets `replyText = ''` and the `setStatus('thinking', …)` call inside `startListening` does **not** exist — but `sendTurn` previously used `setStatus('thinking', …)`; ensure that string is gone.)

- [ ] **Step 11: Full typecheck + build**

Run: `pnpm build`
Expected: `tsc --noEmit` passes (no unused-import or type errors) and `vite build` writes `dist/`.

If `tsc` flags `replyText` as unused (it may now be only assigned, never read): remove the `let replyText = ''` declaration and every `replyText = ''` / `replyText =` assignment line in `main.ts`, then re-run `pnpm build`.

- [ ] **Step 12: Run the full unit suite**

Run: `pnpm test`
Expected: PASS (all suites: messages, conversation, render).

- [ ] **Step 13: Commit**

```bash
git add src/main.ts
git commit -m "Wire glasses to flat attributed chat log"
```

---

## Task 9: Verify behavior end-to-end + finalize

**Files:** none (verification + optional sim run)

- [ ] **Step 1: Confirm gates are green**

Run: `pnpm test && pnpm build`
Expected: tests PASS, build succeeds.

- [ ] **Step 2: Live/simulator smoke test (the routing risk)**

Start the simulator: `pnpm run sim` (configure Soniox + Telegram + a group with a forum topic via the companion WebView). Verify on the glasses view:

- A message from another **human** in the active topic appears live, labeled with their first name (or `@username` / `Someone`).
- A **bot** reply appears labeled (`Bot` or its name); a bot **edit** updates the same line in place (no duplicate).
- Your own push-to-talk message appears immediately as `You: …` and does **not** duplicate when its echo arrives.
- Messages from a **different topic** do not leak into the current view (confirms `chatId`/`topicId` filtering).
- Consecutive messages from one speaker group under a single name; a speaker change shows the light rule.

> If a human/bot message does not appear live, log a normalized message in `onTgMessage` and confirm `m.chatId` exactly equals `settings.tgGroupId` and `m.topicId` equals `active.topicId`. These two comparisons are the known risk (Telegram marked-id format + forum `replyTo`); adjust `normalize` if the live shape differs from the assumption.

- [ ] **Step 3: Update README layout notes (optional, if behavior described there changed)**

The README "Turn model" section describes reading back "whatever responds". No change required, but if you reference the reply-pairing anywhere, align it with the flat-log model.

- [ ] **Step 4: Final review against the spec**

Re-read `docs/superpowers/specs/2026-06-03-glasses-speaker-attribution-design.md` and confirm each goal is met.

---

## Self-review notes

- **Spec coverage:** Msg model (Task 4) · senderLabel fallback (Task 2) · all-senders live + topic scoping + upsert/edits (Tasks 5,7,8) · optimistic echo + reconcile (Tasks 4,8) · flat render w/ grouping + speaker-change rule (Task 6,8) · drop thinking/pairing (Task 8) · history seeding via messagesToLog (Tasks 5,8) · Vitest (Task 1). All covered.
- **Type consistency:** `Msg { id, from, text, mine }`, `upsertMsg`/`removeById`/`reconcileSend`, `senderLabel`/`topicIdOf`/`messagesToLog`, `renderConversation(msgs, divider)`, `sendToTopic(): Promise<number>` are used identically across tasks.
- **Routing risk** is isolated to `normalize` (`chatId`/`topicId`) and verified live in Task 9.
