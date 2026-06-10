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
  canTranscribe,
  hasTelegram,
  hasPins,
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
import {
  applyIncomingMessage,
  historyFor,
  shouldRefreshHistoryOnTopicSwitch,
} from './conversation-state'
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
const CONTAINER_NAME = 'ergram' // shared by the text view and the list pickers

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

/** The conversation a chat/topic frame is anchored to (a pinned dialog). */
interface ActiveConversation {
  id: string // marked chat id (matches TgMessage.chatId)
  title: string
  isForum: boolean
}

// Navigation is a stack of frames; the top frame is the current view. A click
// descends (pushes the next picker, or a chat if the selection is a leaf); a
// double-tap pops one level. The conversation list is the home (length 1).
type Frame =
  | { kind: 'conversations' }
  | { kind: 'topics'; conv: ActiveConversation }
  | { kind: 'chat'; conv: ActiveConversation; topic: ActiveTopic }

let stack: Frame[] = [{ kind: 'conversations' }]
function top(): Frame {
  return stack[stack.length - 1]
}
function activeChat(): { conv: ActiveConversation; topic: ActiveTopic } | null {
  const f = top()
  return f.kind === 'chat' ? { conv: f.conv, topic: f.topic } : null
}
function isActiveChat(chatId: string, topicId: number): boolean {
  const ac = activeChat()
  return !!ac && ac.conv.id === chatId && ac.topic.topicId === topicId
}
function chatLabel(conv: ActiveConversation, topic: ActiveTopic): string {
  return conv.isForum ? `${conv.title} · ${topic.title}` : conv.title
}

const bridge = await waitForEvenAppBridge()
let settings = await loadSettings(bridge)

// ── Telegram client (single module-level instance) ──
let tg: TgClient | null = null
let unsubscribeTg: (() => void) | null = null

function detachTelegram(): void {
  try {
    unsubscribeTg?.()
  } catch {
    // Best-effort cleanup; the client may already be disconnected.
  }
  unsubscribeTg = null
}

function attachTelegram(client: TgClient): void {
  detachTelegram()
  unsubscribeTg = client.subscribe(onTgMessage)
}

// ── Conversation state. Each (chatId, topicId) keeps its own scrollable log. ──
const histories = new Map<string, Msg[]>()

// Optimistic placeholders use decreasing negative ids so they never collide
// with real (positive) Telegram message ids.
let localSeq = -1
function nextLocalId(): number {
  return localSeq--
}

function messageOf(err: unknown): string {
  return (err as Error)?.message || String(err)
}

// ── Turn state ──
let mode: Mode = 'idle'
let stt: SttClient | null = null
let transcriptText = ''
let history: Msg[] = [] // the active chat's log (composeDoc renders this)

// Bound on-glasses scrollback per log. The line-window only ever writes ~10
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
      attachTelegram(tg)
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
    // Repaint home if a settings/pin change happened while idle on a picker.
    if (mode === 'idle' && !transcriptText && !activeChat()) reflectIdle()
  },
  onTgLogin: async (creds, prompts) => {
    const previous = tg
    detachTelegram()
    await previous?.disconnect().catch(() => undefined)

    const next = new TgClient(creds)
    try {
      await next.login(prompts)
    } catch (err) {
      await next.disconnect().catch(() => undefined)
      throw err
    }

    tg = next
    const session = next.saveSession()
    settings = { ...settings, tgSession: session }
    await saveSettings(bridge, settings)
    uiHandle.updateSession(session)
    attachTelegram(next)
    // Reflect the new state on the glasses immediately so there's no "reopen the
    // app" step after onboarding.
    if (mode === 'idle' && !transcriptText && !activeChat()) reflectIdle()
    const me = await next.client.getMe()
    return (
      '@' +
      ((me as unknown as { username?: string; firstName?: string }).username ??
        (me as unknown as { firstName?: string }).firstName ??
        'you')
    )
  },
  onTgLogout: async () => {
    const client = tg
    let revokeError: unknown = null
    let revoked = false

    // Stop active capture before tearing down auth.
    await bridge.audioControl(false)
    stt?.close()
    stt = null

    tg = null
    detachTelegram()
    mode = 'idle'
    transcriptText = ''
    history = []
    stack = [{ kind: 'conversations' }]
    topicList = []
    histories.clear()

    try {
      if (client) {
        await client.revokeSession()
        revoked = true
      }
    } catch (err) {
      revokeError = err
      try {
        await client?.disconnect()
      } catch {
        // Ignore local disconnect errors after a failed revoke.
      }
    } finally {
      // Always remove the powerful session string from device storage. If remote
      // revocation failed, the UI tells the user how to revoke from Telegram.
      settings = { ...settings, tgSession: '' }
      await saveSettings(bridge, settings)
      uiHandle.updateSession('')
      reflectIdle()
    }

    if (revoked) {
      return { revoked: true, message: 'Telegram session revoked and local session cleared.' }
    }

    const detail = revokeError ? ` (${messageOf(revokeError)})` : ''
    return {
      revoked: false,
      message: `Local session cleared, but Telegram did not confirm remote revocation${detail}. Remove ERGram from Telegram Settings → Devices.`,
    }
  },
  onLoadDialogs: async () => {
    if (!tg) throw new Error('Connect Telegram first')
    return tg.getDialogs()
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
  if (top().kind !== 'chat') return // never write text to a list container
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
async function showListContainer(labels: string[]): Promise<void> {
  await bridge.rebuildPageContainer(
    new RebuildPageContainer({ containerTotalNum: 1, listObject: [pickerContainer(labels)] }),
  )
}

// ── Flat-log rendering ──
function listeningBody(): string {
  return transcriptText || '(speak now)'
}
function composeDoc(): string {
  return renderConversation(history, SPEAKER_DIVIDER) || HINT_IDLE
}
// Upsert a message into a log, then trim it to the scrollback budget.
function appendMsg(log: Msg[], msg: Msg): void {
  upsertMsg(log, msg)
  let total = log.reduce((n, m) => n + m.from.length + m.text.length + 16, 0)
  while (log.length > 1 && total > HISTORY_CHAR_BUDGET) {
    const dropped = log.shift()!
    total -= dropped.from.length + dropped.text.length + 16
  }
}

// ── Setup gating ──
// A hint string while the app isn't fully ready; null once it is (Soniox key +
// live Telegram session + at least one pinned conversation).
function setupHint(): string | null {
  if (!canTranscribe(settings)) return 'Add your Soniox key in the app'
  if (!tg || !hasTelegram(settings)) return 'Connect Telegram in the app'
  if (!hasPins(settings)) return 'Pin conversations in the app'
  return null
}
function isConfigured(): boolean {
  return setupHint() === null
}

// ── Frame rendering ──
// Repaint whatever the top frame is. Used on navigation (push/pop) and idle.
async function renderTop(): Promise<void> {
  const f = top()
  if (f.kind === 'conversations') await showConversationsPicker()
  else if (f.kind === 'topics') await showTopicsPicker(f.conv)
  else await enterChat(f.conv, f.topic)
}

// Lightweight idle repaint: refresh the active chat in place, or rebuild the
// current picker. Avoids re-seeding history when we're just returning to idle.
function reflectIdle(): void {
  mode = 'idle'
  transcriptText = ''
  followTail = true

  const ac = activeChat()
  if (ac) {
    setStatus('idle', `Ready · ${chatLabel(ac.conv, ac.topic)}`)
    setDoc(composeDoc())
    return
  }
  void renderTop()
}

async function showConversationsPicker(): Promise<void> {
  const hint = setupHint()
  if (hint) {
    await showTextContainer(hint)
    setStatus('idle', hint)
    return
  }
  await showListContainer(settings.pinnedConversations.map((p) => p.title))
  setStatus('idle', 'Pick a conversation')
}

// ── Topic picker (Level 1, forum supergroups only) ──
let topicList: Topic[] = []
let pickerBusy = false

async function showTopicsPicker(conv: ActiveConversation): Promise<void> {
  if (pickerBusy) return
  if (!tg) {
    reflectIdle()
    return
  }
  pickerBusy = true

  await showListContainer(['Loading topics…'])

  try {
    topicList = await tg.getForumTopics(conv.id)
  } catch (err) {
    console.error('getForumTopics failed:', err)
    topicList = []
  }

  if (!shouldShowTopicPicker(topicList)) {
    // No topics after all → collapse this level into the main chat.
    pickerBusy = false
    if (top().kind === 'topics') stack.pop()
    const topic = MAIN_CHAT_TOPIC
    stack.push({ kind: 'chat', conv, topic })
    await enterChat(conv, topic)
    return
  }

  if (top().kind === 'topics') {
    await showListContainer(topicList.map((t) => `  ${t.title}`))
    setStatus('idle', `${conv.title} · pick a topic`)
  }
  pickerBusy = false
}

// ── Chat (leaf) ──
let switchingChat = false

async function enterChat(conv: ActiveConversation, topic: ActiveTopic): Promise<void> {
  if (switchingChat) return
  switchingChat = true

  history = historyFor(histories, conv.id, topic.topicId)
  mode = 'idle'
  transcriptText = ''
  followTail = true
  lineOffset = 0

  await showTextContainer(' ') // switch container type back from list → text

  if (shouldRefreshHistoryOnTopicSwitch(history)) {
    if (history.length === 0) setDoc('Loading…')
    try {
      const msgs = await tg!.getTopicHistory(conv.id, topic.threadId, 20)
      // Guard: user may have navigated away while loading.
      if (isActiveChat(conv.id, topic.topicId)) {
        seedHistory(history, messagesToLog(msgs))
      }
    } catch (err) {
      console.error('getTopicHistory failed:', err)
    }
  }

  switchingChat = false
  if (isActiveChat(conv.id, topic.topicId)) {
    setStatus('idle', `Ready · ${chatLabel(conv, topic)}`)
    setDoc(composeDoc())
  }
}

// ── Navigation ──
function selectConversation(index: number): void {
  const p = settings.pinnedConversations[index]
  if (!p) return
  const conv: ActiveConversation = { id: p.id, title: p.title, isForum: p.isForum }
  if (p.isForum) {
    stack.push({ kind: 'topics', conv })
    void showTopicsPicker(conv)
  } else {
    const topic = MAIN_CHAT_TOPIC
    stack.push({ kind: 'chat', conv, topic })
    void enterChat(conv, topic)
  }
}

function selectTopic(index: number): void {
  const f = top()
  if (f.kind !== 'topics') return
  const t = topicList[index]
  if (!t) return
  const topic = activeTopicFromForumTopic(t)
  stack.push({ kind: 'chat', conv: f.conv, topic })
  void enterChat(f.conv, topic)
}

// Double-tap: climb one level. At the conversation list (home) there's no level
// above, so it surfaces the host's exit-confirmation dialog instead. Mode 1 only
// *shows* the dialog — if the user confirms, the host fires SYSTEM_EXIT_EVENT and
// we clean up there; if they cancel, the app stays live. So don't tear down here.
function popLevel(): void {
  if (stack.length <= 1) {
    void bridge.shutDownPageContainer(1)
    return
  }
  stack.pop()
  void renderTop()
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
  if (tg && canChat(settings) && activeChat()) {
    sendTurn(text)
  } else {
    reflectIdle()
  }
}

function sendTurn(userText: string): void {
  const ac = activeChat()
  if (!tg || !ac) {
    reflectIdle()
    return
  }
  const { conv, topic } = ac
  const target = historyFor(histories, conv.id, topic.topicId)

  // Optimistic local echo for instant feedback; reconcile against the real id.
  const tempId = nextLocalId()
  appendMsg(target, { id: tempId, from: '', text: userText, mine: true })

  mode = 'idle'
  transcriptText = ''
  followTail = true
  setStatus('idle', `Ready · ${chatLabel(conv, topic)}`)
  if (isActiveChat(conv.id, topic.topicId)) {
    history = target
    setDoc(composeDoc())
  }

  tg.sendToTopic(conv.id, topic.threadId, userText)
    .then((realId: number) => {
      reconcileSend(target, tempId, realId)
      if (isActiveChat(conv.id, topic.topicId)) {
        history = target
        setDoc(composeDoc())
      }
    })
    .catch((err: unknown) => {
      const temp = target.find((m) => m.id === tempId)
      if (temp) temp.text = `${userText}  (send failed)`
      if (isActiveChat(conv.id, topic.topicId)) {
        history = target
        setStatus('error', `Send failed: ${(err as Error)?.message ?? err}`)
        setDoc(composeDoc())
      }
    })
}

// ── Incoming Telegram messages (new + edits from subscribe) ──
// React to every sender (humans and bots), scoped to the set of pinned chats.
// Upsert by id so edits (e.g. a bot streaming/correcting) update in place. Our
// own outgoing messages also arrive here and upsert onto the reconciled id.
function onTgMessage(m: TgMessage): void {
  const pinnedIds = new Set(settings.pinnedConversations.map((p) => p.id))
  const ac = activeChat()
  const activeRef = ac ? { chatId: ac.conv.id, topicId: ac.topic.topicId } : null

  const changedActive = applyIncomingMessage(histories, pinnedIds, activeRef, m)
  if (!changedActive || !ac) return

  history = historyFor(histories, ac.conv.id, ac.topic.topicId)

  // Don't disturb an in-progress dictation: the message is stored above and will
  // render once listening ends (via composeDoc). Only repaint when idle in chat.
  if (top().kind === 'chat' && mode !== 'listening') {
    mode = 'idle'
    setStatus('idle', `Ready · ${chatLabel(ac.conv, ac.topic)}`)
    setDoc(composeDoc())
  }
}

function toggle(): void {
  if (mode === 'idle') {
    // Only meaningful inside a chat; on a picker/config screen it's a no-op.
    if (activeChat() && isConfigured()) startListening()
  } else if (mode === 'listening') {
    void stopListening()
  }
}

// ── First paint ──
reflectIdle()

// ── Event routing ──
// Protobuf omits zero-value fields, so CLICK_EVENT (0) arrives as `undefined`.
// List row-select → listEvent; swipe scroll → textEvent; taps/lifecycle → sysEvent;
// audio PCM → audioEvent.
let lastDoubleAt = 0 // debounce the firmware's stray second DOUBLE_CLICK
const unsubscribe = bridge.onEvenHubEvent((event) => {
  const pcm = event.audioEvent?.audioPcm
  if (pcm && mode === 'listening') stt?.sendPcm(pcm)

  // Pickers: single-tap on a row selects it (descend one level).
  if (event.listEvent) {
    const idx = event.listEvent.currentSelectItemIndex ?? 0
    const kind = top().kind
    if (kind === 'conversations') selectConversation(idx)
    else if (kind === 'topics') selectTopic(idx)
    return
  }

  // Swipe scroll only applies to the chat (the list scrolls natively).
  const textType = event.textEvent?.eventType ?? null
  if (top().kind === 'chat') {
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
    case OsEventTypeList.DOUBLE_CLICK_EVENT: {
      // One physical double-tap can emit two DOUBLE_CLICK events; debounce so a
      // single gesture only acts once (cancel a dictation, else climb a level).
      const now = Date.now()
      if (now - lastDoubleAt < 500) return
      lastDoubleAt = now
      if (mode === 'listening') void cancelListening()
      else popLevel()
      return
    }
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
      if (top().kind === 'chat') void pushWindow()
      return
    case OsEventTypeList.IMU_DATA_REPORT:
      return
    case OsEventTypeList.CLICK_EVENT: // single tap (we don't enable IMU, so 0 = tap)
      if (top().kind === 'chat' && !sys.imuData) toggle()
      return
  }
})

let cleanedUp = false
function cleanup() {
  if (cleanedUp) return
  cleanedUp = true
  bridge.audioControl(false)
  stt?.close()
  detachTelegram()
  unsubscribe()
}

window.addEventListener('beforeunload', cleanup)
