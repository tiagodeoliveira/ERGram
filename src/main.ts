import {
  waitForEvenAppBridge,
  TextContainerProperty,
  ListContainerProperty,
  ListItemContainerProperty,
  CreateStartUpPageContainer,
  RebuildPageContainer,
  TextContainerUpgrade,
  OsEventTypeList,
} from '@evenrealities/even_hub_sdk'
import { startSttStream, type SttClient } from './asr/stt'
import {
  loadSettings,
  saveSettings,
  saveActiveTopicId,
  canTranscribe,
  hasTelegram,
  canChat,
} from './settings'
import { mountUi, setStatus, flashSaved } from './ui'
import { wrapToLines } from './glasses/wrap'
import { getTextWidth } from '@evenrealities/pretext'
import { TgClient } from './telegram/client'
import { messagesToLog, type TgMessage } from './telegram/messages'
import type { Topic } from './telegram/topics'
import { upsertMsg, reconcileSend, seedHistory, type Msg } from './conversation'
import { renderConversation } from './glasses/render'
import { applyIncomingMessage, shouldRefreshHistoryOnTopicSwitch } from './topic-state'
import {
  activeTopicFromForumTopic,
  MAIN_CHAT_TOPIC,
  shouldShowTopicPicker,
  type ActiveTopic,
} from './topic-selection'

// ── Geometry & rules ──
// Container is 576x288 with paddingLength 4 → 568px text width, 10 lines @ 27px.
const PAD = 4
const INNER_W = 576 - 2 * PAD
const VISIBLE_LINES = Math.floor((288 - 2 * PAD) / 27)
const SCROLL_STEP = 3 // lines per swipe
const HINT_IDLE = 'Tap temple to talk'
const CONTAINER_ID = 1
const CONTAINER_NAME = 'ergram' // shared by the text view and the topic list

// Near-full-width rules sized just under the text width so they never wrap.
// Heavy (━) separates turns; light (─) separates you from the reply within a turn.
function makeRule(ch: string): string {
  let s = ''
  while (getTextWidth(s + ch) <= INNER_W - 6) s += ch
  return s
}
const SPEAKER_DIVIDER = makeRule('─')
const LISTENING_HEADER = `● Listening…   tap: send · 2-tap: cancel\n${SPEAKER_DIVIDER}`

// ── Types ──
type Mode = 'idle' | 'listening'
type View = 'convo' | 'picker'

const bridge = await waitForEvenAppBridge()
let settings = await loadSettings(bridge)

// Group id can be entered with stray whitespace; normalize it everywhere.
function groupId(): string {
  return settings.tgGroupId.trim()
}

// ── Telegram client (single module-level instance) ──
let tg: TgClient | null = null

// ── Topic state. Each topic keeps its own scrollable conversation log. ──
const histories = new Map<number, Msg[]>()
function historyFor(id: number): Msg[] {
  let h = histories.get(id)
  if (!h) {
    h = []
    histories.set(id, h)
  }
  return h
}

let active: ActiveTopic | null = null
let history: Msg[] = []

// Optimistic placeholders use decreasing negative ids so they never collide
// with real (positive) Telegram message ids.
let localSeq = -1
function nextLocalId(): number {
  return localSeq--
}

// ── Turn / view state ──
let mode: Mode = 'idle'
let view: View = 'convo'
let stt: SttClient | null = null
let transcriptText = ''

// Bound on-glasses scrollback per topic. The line-window only ever writes ~10
// lines per frame, so this can be generous without enlarging BLE writes — it
// just sets how far back you can swipe.
const HISTORY_CHAR_BUDGET = 24000

// ── Startup: try to resume Telegram session ──
if (hasTelegram(settings)) {
  try {
    tg = new TgClient({
      apiId: Number(settings.tgApiId),
      apiHash: settings.tgApiHash,
      session: settings.tgSession,
    })
    const ok = await tg.resume()
    if (ok) {
      tg.subscribe(onTgMessage)
    } else {
      tg = null
    }
  } catch {
    tg = null
  }
}

const uiHandle = mountUi(settings, {
  onSave: async (s) => {
    settings = s
    await saveSettings(bridge, s)
    flashSaved()
    if (view === 'convo' && mode === 'idle' && !transcriptText) reflectIdle()
  },
  onTgLogin: async (creds, prompts) => {
    tg = new TgClient(creds)
    await tg.login(prompts)
    const session = tg.saveSession()
    settings = { ...settings, tgSession: session }
    await saveSettings(bridge, settings)
    uiHandle.updateSession(session)
    tg.subscribe(onTgMessage)
    // Reflect the new state on the glasses immediately (→ topic list once a group
    // id is also set), so there's no "reopen the app" step after onboarding.
    if (view === 'convo' && mode === 'idle' && !transcriptText) reflectIdle()
    const me = await tg.client.getMe()
    return (
      '@' +
      ((me as unknown as { username?: string; firstName?: string }).username ??
        (me as unknown as { firstName?: string }).firstName ??
        'you')
    )
  },
  onTgLogout: async () => {
    await tg?.disconnect()
    tg = null
    settings = { ...settings, tgSession: '' }
    await saveSettings(bridge, settings)
  },
})

// ── Rolling line-window renderer ───────────────────────────────────────────
// One continuous document wrapped to exact display lines; we show a sliding
// window and auto-follow the bottom while text streams (chat feel). An optional
// pinned header (the Listening banner) stays fixed above the scrolling body.
let docText = HINT_IDLE
let pinnedText = ''
let pinnedLines: string[] = []
let lines: string[] = [HINT_IDLE]
let lineOffset = 0
let followTail = true
let lastRender = ''
let renderTimer: number | null = null

function availLines(): number {
  return Math.max(1, VISIBLE_LINES - pinnedLines.length)
}
function maxOffset(): number {
  return Math.max(0, lines.length - availLines())
}
function windowContent(): string {
  // SDK content must be non-empty; a single space is the documented placeholder.
  const body = lines.slice(lineOffset, lineOffset + availLines())
  return [...pinnedLines, ...body].join('\n') || ' '
}
async function pushWindow(): Promise<void> {
  if (view !== 'convo') return // never write text to the list container
  const content = windowContent()
  if (content === lastRender) return
  lastRender = content
  await bridge.textContainerUpgrade(
    new TextContainerUpgrade({ containerID: CONTAINER_ID, containerName: CONTAINER_NAME, content }),
  )
}
// Update the document (+ optional pinned header). Debounced so streaming token
// bursts coalesce into one BLE write per tick.
function setDoc(text: string, pinned = ''): void {
  docText = text
  pinnedText = pinned
  if (renderTimer !== null) return
  renderTimer = window.setTimeout(() => {
    renderTimer = null
    pinnedLines = pinnedText ? wrapToLines(pinnedText, INNER_W) : []
    lines = wrapToLines(docText, INNER_W)
    if (followTail) lineOffset = maxOffset()
    else lineOffset = Math.min(lineOffset, maxOffset())
    void pushWindow()
  }, 100)
}
function scrollLines(delta: number): void {
  const next = Math.max(0, Math.min(maxOffset(), lineOffset + delta))
  if (next === lineOffset) return
  lineOffset = next
  followTail = lineOffset >= maxOffset()
  void pushWindow()
}

// ── Glasses containers ──
function textContainer(content: string): TextContainerProperty {
  return new TextContainerProperty({
    xPosition: 0,
    yPosition: 0,
    width: 576,
    height: 288,
    borderWidth: 0,
    borderColor: 5,
    paddingLength: PAD,
    containerID: CONTAINER_ID,
    containerName: CONTAINER_NAME,
    content,
    isEventCapture: 1,
  })
}
function pickerContainer(labels: string[]): ListContainerProperty {
  return new ListContainerProperty({
    xPosition: 0,
    yPosition: 0,
    width: 576,
    height: 288,
    borderWidth: 0,
    paddingLength: 8,
    containerID: CONTAINER_ID,
    containerName: CONTAINER_NAME,
    isEventCapture: 1,
    itemContainer: new ListItemContainerProperty({
      itemCount: labels.length,
      itemWidth: 0,
      isItemSelectBorderEn: 1,
      itemName: labels,
    }),
  })
}

const created = await bridge.createStartUpPageContainer(
  new CreateStartUpPageContainer({ containerTotalNum: 1, textObject: [textContainer('Loading…')] }),
)
if (created !== 0) {
  setStatus('error', `createStartUpPageContainer failed: ${created}`)
  console.error('Failed to create startup page')
}

// Switching container TYPE (text ↔ list) requires a full rebuild, not an upgrade.
async function showTextContainer(content: string): Promise<void> {
  await bridge.rebuildPageContainer(
    new RebuildPageContainer({ containerTotalNum: 1, textObject: [textContainer(content)] }),
  )
  lastRender = content
}

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

// ── State transitions ──
// Fully set up = Soniox key + live Telegram session + a target group. Until then
// the glasses show a single "configure" prompt; once ready they go straight to
// the topic list (no intermediate "tap temple" screen).
function isConfigured(): boolean {
  return !!tg && canChat(settings)
}

function reflectIdle(): void {
  mode = 'idle'
  transcriptText = ''
  followTail = true

  if (!isConfigured()) {
    setStatus('idle', 'Configure ERGram in the app')
    setDoc('Configure ERGram in the app')
    return
  }

  // Configured but no topic picked yet → open the topic list directly.
  if (!active) {
    void enterPicker()
    return
  }

  // Inside a topic → show its conversation.
  setStatus('idle', `Ready · ${active.title}`)
  setDoc(composeDoc())
}

function startListening(): void {
  if (!canTranscribe(settings)) {
    setStatus('error', 'Enter your Soniox API key in settings')
    return
  }
  transcriptText = ''
  followTail = true
  lineOffset = 0
  try {
    stt = startSttStream(
      settings.sonioxKey,
      (snap) => {
        transcriptText = (snap.finalText + snap.interimText).trim()
        if (mode === 'listening') setDoc(listeningBody(), LISTENING_HEADER)
      },
      (err) => {
        setStatus('error', `STT: ${(err as Error)?.message ?? err}`)
        console.error('STT error:', err)
      },
    )
  } catch (err) {
    setStatus('error', (err as Error)?.message ?? 'STT startup failed')
    return
  }

  bridge.audioControl(true)
  mode = 'listening'
  setStatus('listening', 'Listening · tap to send')
  setDoc(listeningBody(), LISTENING_HEADER)
}

// Abort the current utterance without sending it (double-tap while listening).
async function cancelListening(): Promise<void> {
  await bridge.audioControl(false)
  stt?.close()
  stt = null
  reflectIdle()
}

async function stopListening(): Promise<void> {
  await bridge.audioControl(false)
  stt?.close()
  stt = null

  const text = transcriptText.trim()

  if (!text) {
    reflectIdle()
    return
  }
  if (canChat(settings) && active) {
    sendTurn(text)
  } else {
    appendMsg(history, { id: nextLocalId(), from: '', text, mine: true })
    mode = 'idle'
    setStatus('idle', 'Transcribed · connect Telegram to chat')
    setDoc(composeDoc())
    transcriptText = ''
  }
}

function sendTurn(userText: string): void {
  if (!tg || !active) {
    reflectIdle()
    return
  }
  const topicId = active.topicId
  const threadId = active.threadId
  const target = historyFor(topicId)

  // Optimistic local echo for instant feedback; reconcile against the real id.
  const tempId = nextLocalId()
  appendMsg(target, { id: tempId, from: '', text: userText, mine: true })

  mode = 'idle'
  transcriptText = ''
  followTail = true
  setStatus('idle', `Ready · ${active.title}`)
  if (active.topicId === topicId) {
    history = target
    setDoc(composeDoc())
  }

  tg.sendToTopic(groupId(), threadId, userText)
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

// ── Incoming Telegram messages (new + edits from subscribe) ──
// React to every sender (humans and bots), scoped to the active group + topic.
// Upsert by id so edits (e.g. a bot streaming/correcting) update in place. Our
// own outgoing messages also arrive here and upsert onto the reconciled id.
function onTgMessage(m: TgMessage): void {
  const changedActive = applyIncomingMessage(histories, active, groupId(), m)
  if (!changedActive || !active) return

  history = historyFor(active.topicId)

  // Don't disturb an in-progress dictation: the message is stored above and will
  // render once listening ends (via composeDoc). Only repaint when idle in convo.
  if (view === 'convo' && mode !== 'listening') {
    mode = 'idle'
    setStatus('idle', `Ready · ${active.title}`)
    setDoc(composeDoc())
  }
}

function toggle(): void {
  if (mode === 'idle') {
    // Only meaningful inside a topic; on the picker/config screen it's a no-op.
    if (active && isConfigured()) startListening()
  } else if (mode === 'listening') {
    void stopListening()
  }
}

// ── Topic picker (a list container swapped in over the conversation) ──
let topicList: Topic[] = []
let pickerBusy = false

async function enterPicker(): Promise<void> {
  if (pickerBusy) return
  if (!tg || !groupId()) {
    reflectIdle()
    return
  }
  pickerBusy = true
  view = 'picker'

  // Show a placeholder list while we fetch.
  await bridge.rebuildPageContainer(
    new RebuildPageContainer({
      containerTotalNum: 1,
      listObject: [pickerContainer(['Loading topics…'])],
    }),
  )

  try {
    topicList = await tg.getForumTopics(groupId())
  } catch (err) {
    console.error('getForumTopics failed:', err)
    topicList = []
  }

  if (!shouldShowTopicPicker(topicList)) {
    pickerBusy = false
    await switchToTopic(MAIN_CHAT_TOPIC)
    return
  }

  const labels = topicList.map((t) =>
    active && t.id === active.topicId ? `* ${t.title}` : `  ${t.title}`,
  )

  if (view === 'picker') {
    // Still in picker view — refresh the list.
    await bridge.rebuildPageContainer(
      new RebuildPageContainer({ containerTotalNum: 1, listObject: [pickerContainer(labels)] }),
    )
  }
  pickerBusy = false
}

function selectPicker(index: number): void {
  const t = topicList[index]
  if (t) void switchToTopic(activeTopicFromForumTopic(t))
}

let switchingTopic = false

async function switchToTopic(t: ActiveTopic): Promise<void> {
  if (switchingTopic) return
  switchingTopic = true

  active = t
  await saveActiveTopicId(bridge, t.topicId)
  history = historyFor(t.topicId)

  mode = 'idle'
  transcriptText = ''
  followTail = true
  lineOffset = 0
  view = 'convo'

  await showTextContainer(' ') // switch container type back from list → text

  if (shouldRefreshHistoryOnTopicSwitch(history)) {
    if (history.length === 0) setDoc('Loading…')
    try {
      const msgs = await tg!.getTopicHistory(groupId(), t.threadId, 20)
      // Guard: user may have switched away while loading.
      if (active?.topicId === t.topicId) {
        seedHistory(history, messagesToLog(msgs))
      }
    } catch (err) {
      console.error('getTopicHistory failed:', err)
    }
  }

  switchingTopic = false
  reflectIdle()
}

// ── First paint ──
// reflectIdle() decides: configured → topic list, otherwise the configure prompt.
reflectIdle()

// ── Event routing ──
// Protobuf omits zero-value fields, so CLICK_EVENT (0) arrives as `undefined`.
// List row-select → listEvent; swipe scroll → textEvent; taps/lifecycle → sysEvent;
// audio PCM → audioEvent.
const unsubscribe = bridge.onEvenHubEvent((event) => {
  const pcm = event.audioEvent?.audioPcm
  if (pcm && mode === 'listening') stt?.sendPcm(pcm)

  // Topic picker: single-tap on a row selects it.
  if (event.listEvent) {
    if (view === 'picker') selectPicker(event.listEvent.currentSelectItemIndex ?? 0)
    return
  }

  // Swipe scroll only applies to the conversation (the list scrolls natively).
  const textType = event.textEvent?.eventType ?? null
  if (view === 'convo') {
    if (textType === OsEventTypeList.SCROLL_TOP_EVENT) {
      scrollLines(-SCROLL_STEP)
      return
    }
    if (textType === OsEventTypeList.SCROLL_BOTTOM_EVENT) {
      scrollLines(SCROLL_STEP)
      return
    }
  }

  const sys = event.sysEvent
  if (!sys) return
  const sysType = sys.eventType ?? 0

  switch (sysType) {
    case OsEventTypeList.DOUBLE_CLICK_EVENT:
      // Picker is home — double-tap there does nothing (and absorbs the stray
      // second DOUBLE_CLICK the firmware emits for one physical double-tap).
      if (view === 'picker') return
      if (mode === 'listening')
        void cancelListening() // dictating → cancel the message
      else if (tg && groupId()) void enterPicker() // chat → back to list
      return
    case OsEventTypeList.SYSTEM_EXIT_EVENT:
    case OsEventTypeList.ABNORMAL_EXIT_EVENT:
      // The host drives exit (long-press → "Leave app?"); confirming it lands
      // here. Release hardware/listeners, then tell the host to tear down the
      // page container we created at startup. exitMode 0 = exit immediately —
      // the user already confirmed via the host dialog, so don't pop a second.
      cleanup()
      void bridge.shutDownPageContainer(0)
      return
    case OsEventTypeList.FOREGROUND_EXIT_EVENT:
      if (mode === 'listening') void stopListening()
      return
    case OsEventTypeList.FOREGROUND_ENTER_EVENT:
      if (view === 'convo') void pushWindow()
      return
    case OsEventTypeList.IMU_DATA_REPORT:
      return
    case OsEventTypeList.CLICK_EVENT: // single tap (we don't enable IMU, so 0 = tap)
      if (view === 'convo' && !sys.imuData) toggle()
      return
  }
})

let cleanedUp = false
function cleanup() {
  if (cleanedUp) return
  cleanedUp = true
  bridge.audioControl(false)
  stt?.close()
  unsubscribe()
}

window.addEventListener('beforeunload', cleanup)
