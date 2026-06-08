# ERGram

> Talk on Telegram from Even Realities G2 smart glasses — push-to-talk voice, transcribed and sent as you.

ER = Even Realities · Gram = Telegram.

Push-to-talk voice on the glasses → [Soniox](https://soniox.com) real-time speech-to-text → your
message is posted **into the conversation you picked, as you** (via a GramJS MTProto userbot running in
the PWA). The conversation can be a 1:1, a bot, a channel you can post to, or a group — and for a forum
group, a specific topic. Whatever responds there — a bot/agent or another member — is read back onto
the glasses. The PWA _is_ the whole app: it runs inside the Even Realities companion app, captures the
glasses mic via the Even Hub SDK, and talks directly to Soniox and Telegram. No separate server.

```
Glasses mic ──(Even Hub SDK audioPcm)──►  this PWA  ──►  Soniox (real-time STT)
   tap to talk · tap to send             (userbot)   ──►  Telegram conversation ⇄ the chat
```

Because the conversation lives in the Telegram chat, history is unified — what you say on the glasses
appears in Telegram, and vice-versa.

## Navigation & turn model

The G2 touchpad only emits discrete gestures (no press-and-hold), so push-to-talk is **tap-to-toggle**,
and navigation is a **level-stack** — click descends, double-tap climbs back up:

- **Single tap** — in a chat, start talking (mic opens, streams to Soniox); tap again to stop and send.
  On a list, select the highlighted row to descend a level.
- **Double tap** — while listening, cancel the utterance; otherwise go **up one level** (chat → topic
  list or conversation list; topic list → conversation list). On the conversation list (home) there's no
  level above, so a double tap raises the host's **"Leave app?"** confirmation.
- **Swipe up / down** — scroll back through the chat / return to the latest.

Launch drops you on the **conversation list** — the up-to-five conversations you pinned in the app.
Selecting one descends: a 1:1, bot, channel, or non-forum group goes **straight to the chat**; a forum
group opens its **topic list** (live Telegram topic names) to pick from first. Each chat keeps its own
scrollable log, seeded from its recent Telegram history. To exit, double-tap on the home list (or
long-press) → "Leave app?".

## Settings (entered in the companion-app WebView, persisted on-device)

A **step-by-step Telegram onboarding wizard**:

1. **API ID + API Hash** — one-time, from [my.telegram.org](https://my.telegram.org) → "API development tools".
2. **Phone** → **Send code** → enter the code → **2FA password** (if you have one) → **Connected as @you**.

Then:

| Setting        | What it does                                                                                                                                                                       |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Soniox API key | Soniox real-time STT auth (`sox_…`)                                                                                                                                                |
| Conversations  | Once connected, search your recent chats and **tap the star to pin up to 5**. 1:1s, bots, postable channels, and groups are pinnable; pin order is the order shown on the glasses. |

The Telegram **session string** (minted by the login, full account access) and the other values are
saved via the SDK's `setLocalStorage` (the only reliable persistence in the Even App WebView). Until
you're fully set up (Soniox key + Telegram login + at least one pinned conversation) the glasses show a
short setup prompt (`Add your Soniox key…` / `Connect Telegram…` / `Pin conversations…`); once ready
they open the **conversation list** — pick a conversation, then tap to talk.

## Develop

```bash
pnpm install
pnpm run dev          # Vite dev server on :5173
pnpm run sim          # Vite + the Even Hub simulator together (desktop)
# QR for real glasses (or use the Even Realities app's dev mode → connect to the Vite URL):
pnpm exec evenhub qr --url http://<your-lan-ip>:5173
```

`pnpm run sim` starts the dev server and the Even Hub simulator side by side (the simulator waits for
Vite, then connects to `http://localhost:5173`). To capture from a specific host microphone, set
`ERGRAM_SIM_AID` (e.g. `ERGRAM_SIM_AID=pulse:default pnpm run sim`); unset, it uses the default input.
`pnpm run simulate` runs just the simulator against an already-running dev server.

GramJS needs Node globals in the browser: `vite-plugin-node-polyfills` provides process/global, and
`src/buffer-global.ts` supplies a single `Buffer` from the `buffer` package (`resolve.dedupe: ['buffer']`
plus `pnpm.overrides.buffer`) — without this, GramJS's `instanceof Buffer` cross-fails at 2FA. The
client uses `useWSS: true`.

### Quality gate

`pnpm lint` (ESLint + `@typescript-eslint`) and `pnpm typecheck` (`tsc --noEmit`) run automatically on
every commit via a Husky pre-commit hook (lint-staged formats with Prettier, then the whole project is
typechecked). `pnpm test` runs the Vitest suite over the pure logic modules.

## Build / package

```bash
pnpm run build        # typecheck + vite build → dist/
pnpm ehpk             # → ergram.ehpk for the glasses
```

> The Even Hub sandbox enforces `app.json`'s `network.whitelist`. Soniox, `my.telegram.org`, and
> Telegram's DC endpoints (`wss://{pluto,venus,aurora,vesta,flora}.web.telegram.org`) are listed; dev
> origins too. `pnpm ehpk` runs `scripts/check-network-whitelist.mjs` first — it scans the built bundle
> for URL literals and fails if any active endpoint isn't covered, reproducing the portal's submission
> scan locally. GramJS's runtime transport templates (`wss://${e}:${r}/apiws…`) and vendored doc strings
> are pre-classified as known-safe there, so the gate only trips on a genuinely new un-whitelisted host.

## Layout

- `src/main.ts` — bridge init, glasses page, PTT state machine, level-stack navigation
  (conversations → topics → chat), event routing
- `src/asr/stt.ts` — Soniox real-time WebSocket client
- `src/telegram/client.ts` — GramJS userbot (login / dialogs / topics / send / history / subscribe)
- `src/telegram/topics.ts` · `messages.ts` — forum-topic + message→turn helpers (pure)
- `src/pins.ts` — pinned-conversation list: add/remove, cap at 5, serialize for the store (pure)
- `src/dialogs.ts` — classify & filter Telegram dialogs into the pinnable set (pure)
- `src/conversation-state.ts` — composite `(chatId, topicId)` history keying + incoming routing (pure)
- `src/topic-selection.ts` — forum-topic picker logic (pure)
- `src/conversation.ts` — flat attributed chat log: upsert / reconcile / seed (pure)
- `src/glasses/render.ts` · `wrap.ts` — on-glasses conversation rendering
- `src/buffer-global.ts` — the single global `Buffer` GramJS needs
- `src/settings.ts` — load/save settings (Soniox key, Telegram creds, pinned conversations)
- `src/ui.ts` — companion-app WebView panel (onboarding wizard + conversation pinning)

## License

[MIT](LICENSE) © Tiago Oliveira
