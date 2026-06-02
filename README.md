# ERGram

> Talk on a Telegram group from Even Realities G2 smart glasses — push-to-talk voice, transcribed and sent as you.

ER = Even Realities · Gram = Telegram.

Push-to-talk voice on the glasses → [Soniox](https://soniox.com) real-time speech-to-text → your
message is posted **into a Telegram topic as you** (via a GramJS MTProto userbot running in the PWA).
Whatever responds in that topic — a bot/agent or another member — is read back onto the glasses. The
PWA *is* the whole app: it runs inside the Even Realities companion app, captures the glasses mic via
the Even Hub SDK, and talks directly to Soniox and Telegram. No separate server.

```
Glasses mic ──(Even Hub SDK audioPcm)──►  this PWA  ──►  Soniox (real-time STT)
   tap to talk · tap to send             (userbot)   ──►  Telegram topic ⇄ the group
```

Because the conversation lives in the Telegram topic, history is unified — what you say on the glasses
appears in Telegram, and vice-versa.

## Turn model

The G2 touchpad only emits discrete gestures (no press-and-hold), so push-to-talk is **tap-to-toggle**:

- **Single tap** — start talking (mic opens, streams to Soniox); tap again to stop and send into the topic.
- **Double tap** — while listening, cancel the utterance; in a conversation, go back to the topic list;
  on the topic list, do nothing.
- **Swipe up / down** — scroll back through the conversation / return to the latest.

Launch drops you on the **topic picker** — the glasses fetch your group's forum topics live (real
Telegram names) and you pick one. Each topic keeps its own scrollable log, seeded from the topic's
recent Telegram history.

## Settings (entered in the companion-app WebView, persisted on-device)

A **step-by-step Telegram onboarding wizard**:

1. **API ID + API Hash** — one-time, from [my.telegram.org](https://my.telegram.org) → "API development tools".
2. **Phone** → **Send code** → enter the code → **2FA password** (if you have one) → **Connected as @you**.

Plus two fields:

| Field | Example | Used as |
|---|---|---|
| Group ID | `-1001234567890` | the supergroup whose topics the glasses list (copy from the Telegram UI) |
| Soniox API key | `sox_…` | Soniox real-time STT auth |

The Telegram **session string** (minted by the login, full account access) and the other values are
saved via the SDK's `setLocalStorage` (the only reliable persistence in the Even App WebView). Until
you're fully set up (Soniox key + Telegram login + a group id) the glasses show a single
`Configure ERGram in the app` prompt; once ready they open the **topic list** — pick a topic, then tap
to talk.

## Develop

```bash
pnpm install
pnpm run dev          # Vite dev server on :5173
# QR for real glasses (or use the Even Realities app's dev mode → connect to the Vite URL):
pnpm exec evenhub qr --url http://<your-lan-ip>:5173
```

GramJS needs Node globals in the browser: `vite-plugin-node-polyfills` provides process/global, and
`src/buffer-global.ts` supplies a single `Buffer` from the `buffer` package (`resolve.dedupe: ['buffer']`
+ `pnpm.overrides.buffer`) — without this, GramJS's `instanceof Buffer` cross-fails at 2FA. The client
uses `useWSS: true`.

## Build / package

```bash
pnpm run build        # typecheck + vite build → dist/
pnpm run pack         # → ergram.ehpk for the glasses
```

> The Even Hub sandbox enforces `app.json`'s `network.whitelist`. Soniox and Telegram's DC endpoints
> (`wss://{pluto,venus,aurora,vesta,flora}.web.telegram.org`) are listed; dev origins too.

## Layout

- `src/main.ts` — bridge init, glasses page, PTT state machine, topic picker, event routing
- `src/asr/stt.ts` — Soniox real-time WebSocket client
- `src/telegram/client.ts` — GramJS userbot (login / topics / send / history / subscribe)
- `src/telegram/topics.ts` · `messages.ts` — forum-topic + message→turn helpers (pure)
- `src/buffer-global.ts` — the single global `Buffer` GramJS needs
- `src/settings.ts` — load/save settings via the Even Hub store
- `src/ui.ts` — companion-app WebView panel (onboarding wizard + group id + transcript/reply)

## License

[MIT](LICENSE) © Tiago Oliveira
