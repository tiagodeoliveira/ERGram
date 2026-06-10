// Phone-side UI (the HTML panel shown inside the Even Realities companion app).
//
// This is NOT what renders on the glasses — the glasses get a TextContainer
// driven from main.ts. This panel is where you connect Telegram (step-by-step
// wizard), pin the conversations to surface on the glasses, and enter the
// Soniox key.

import type { LoginPrompts, TgCredentials } from './telegram/client'
import type { Settings } from './settings'
import { togglePin, canPinMore, MAX_PINS, type Pin } from './pins'
import { filterDialogs, type Dialog } from './dialogs'

export type Status = 'idle' | 'listening' | 'thinking' | 'error'

export interface TgLogoutResult {
  /** true only when Telegram confirmed auth.logOut for this session. */
  revoked: boolean
  /** User-facing summary of what happened. */
  message: string
}

// Step state for the Telegram onboarding wizard.
type Step = 'keys' | 'phone' | 'code' | 'password' | 'connected'

interface UiHandlers {
  onSave: (s: Settings) => void
  /** Initiates Telegram login. Resolves with the connected @username on success. */
  onTgLogin: (creds: TgCredentials, prompts: LoginPrompts) => Promise<string>
  onTgLogout: () => Promise<TgLogoutResult>
  /** Fetch the account's postable conversations for the pin list. */
  onLoadDialogs: () => Promise<Dialog[]>
}

// ── Module-level DOM refs ─────────────────────────────────────────────────────
let statusEl: HTMLDivElement
let savedEl: HTMLSpanElement

// Settings form inputs
let sonioxInput: HTMLInputElement

// Conversations section
let convSearchInput: HTMLInputElement
let convRefreshBtn: HTMLButtonElement
let convCountEl: HTMLSpanElement
let convStatusEl: HTMLDivElement
let convListEl: HTMLDivElement

// Wizard step containers
let stepKeys: HTMLDivElement
let stepPhone: HTMLDivElement
let stepCode: HTMLDivElement
let stepPassword: HTMLDivElement
let stepConnected: HTMLDivElement

// Wizard inputs
let apiIdInput: HTMLInputElement
let apiHashInput: HTMLInputElement
let phoneInput: HTMLInputElement
let codeInput: HTMLInputElement
let pwInput: HTMLInputElement

// Wizard status line
let tgStatusEl: HTMLDivElement

// Stepper indicator
let stepperEl: HTMLDivElement

// Connected username display
let connectedNameEl: HTMLSpanElement

// Module-level wizard state
let resolveCode: ((c: string) => void) | null = null
let resolvePassword: ((p: string) => void) | null = null

// Preserved session string (updated on login; survives plain settings saves).
let currentSession = ''

// Conversations state
let pins: Pin[] = []
let allDialogs: Dialog[] = []
let dialogsLoaded = false
let loadDialogs: (() => Promise<Dialog[]>) | null = null

// ── Wizard helpers ────────────────────────────────────────────────────────────

function stepNumber(s: Step): number {
  // 'password' is an optional step; only keys/phone/code/connected count for the
  // "Step N of 4" label shown to the user.
  const linear: Step[] = ['keys', 'phone', 'code', 'connected']
  const i = linear.indexOf(s)
  return i >= 0 ? i + 1 : -1
}

function showStep(s: Step): void {
  const allSteps: Array<[Step, HTMLDivElement]> = [
    ['keys', stepKeys],
    ['phone', stepPhone],
    ['code', stepCode],
    ['password', stepPassword],
    ['connected', stepConnected],
  ]
  for (const [name, el] of allSteps) {
    if (name === s) {
      el.classList.add('active')
    } else {
      el.classList.remove('active')
    }
  }
  // Update stepper hint (omit for 'password' which is an optional sub-step).
  const n = stepNumber(s)
  if (n >= 1) {
    stepperEl.textContent = `Step ${n} of 4`
    stepperEl.style.display = ''
  } else {
    stepperEl.style.display = 'none'
  }
  // Clear the TG status line when moving between steps.
  setTgStatus('', '')
}

function setTgStatus(kind: 'error' | 'ok' | '', text: string): void {
  tgStatusEl.className = kind ? `tg-status tg-status-${kind}` : 'tg-status'
  tgStatusEl.textContent = text
}

// ── Conversations helpers ──────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  )
}

function setConvStatus(kind: 'error' | '', text: string): void {
  convStatusEl.className = kind ? `conv-status conv-status-${kind}` : 'conv-status'
  convStatusEl.textContent = text
}

function rowHtml(id: string, title: string, pinned: boolean, enabled: boolean): string {
  const star = pinned ? '★' : '☆'
  const cls = `conv-row${pinned ? ' pinned' : enabled ? '' : ' disabled'}`
  return (
    `<button type="button" class="${cls}" data-id="${escapeHtml(id)}">` +
    `<span class="conv-star">${star}</span>` +
    `<span class="conv-title">${escapeHtml(title || 'Untitled')}</span>` +
    `</button>`
  )
}

function renderConversations(): void {
  convCountEl.textContent = `Pinned ${pins.length}/${MAX_PINS}`

  const pinnedIds = new Set(pins.map((p) => p.id))
  const candidates = filterDialogs(allDialogs, convSearchInput.value).filter(
    (d) => !pinnedIds.has(d.id),
  )

  const rows: string[] = []
  for (const p of pins) rows.push(rowHtml(p.id, p.title, true, true))
  const roomy = canPinMore(pins)
  for (const d of candidates) rows.push(rowHtml(d.id, d.title, false, roomy))

  convListEl.innerHTML = rows.join('') || '<div class="conv-empty">No conversations</div>'
}

async function refreshDialogs(): Promise<void> {
  if (!loadDialogs) return
  setConvStatus('', 'Loading conversations…')
  convRefreshBtn.disabled = true
  try {
    allDialogs = await loadDialogs()
    dialogsLoaded = true
    setConvStatus('', allDialogs.length ? '' : 'No conversations found')
  } catch (err) {
    setConvStatus('error', String((err as Error)?.message ?? err))
  } finally {
    convRefreshBtn.disabled = false
    renderConversations()
  }
}

// Show/hide the dialog controls based on whether Telegram is connected, and load
// dialogs on first availability.
function updateConvAvailability(): void {
  const connected = currentSession.trim().length > 0
  convSearchInput.style.display = connected ? '' : 'none'
  convRefreshBtn.style.display = connected ? '' : 'none'

  if (!connected) {
    allDialogs = []
    dialogsLoaded = false
    setConvStatus('', 'Connect Telegram above to choose conversations.')
    renderConversations()
    return
  }
  if (!dialogsLoaded) {
    void refreshDialogs()
  } else {
    renderConversations()
  }
}

// ── Mount ─────────────────────────────────────────────────────────────────────

export interface UiHandle {
  /** Call this after persisting a new session string so the Save button stays correct. */
  updateSession(session: string): void
}

export function mountUi(initial: Settings, handlers: UiHandlers): UiHandle {
  currentSession = initial.tgSession
  pins = initial.pinnedConversations
  loadDialogs = handlers.onLoadDialogs

  const app = document.querySelector<HTMLDivElement>('#app')!
  app.innerHTML = `
    <main class="panel">
      <header>
        <h1>ERGram</h1>
        <div id="status" class="status status-idle">Idle</div>
      </header>

      <details class="settings" open>
        <summary>Settings</summary>

        <!-- ── Soniox ── -->
        <label>Soniox API key
          <input id="soniox" type="password" autocomplete="off" spellcheck="false"
            placeholder="sox_…" />
        </label>

        <!-- ── Telegram wizard ── -->
        <div class="tg-section">
          <div class="tg-section-head">Telegram</div>
          <p class="security-note">
            Telegram login creates a session string with full account access. ERGram stores it only
            on this device through Even Hub storage; use your own device and log out/revoke if it
            is lost or shared.
          </p>
          <div id="tg-stepper" class="tg-stepper"></div>

          <!-- Step: keys -->
          <div id="step-keys" class="step">
            <p class="step-hint">
              Get your API credentials at
              <a href="https://my.telegram.org" target="_blank" rel="noreferrer">my.telegram.org</a>
              → API development tools.
            </p>
            <label>API ID
              <input id="tg-api-id" type="text" inputmode="numeric" autocomplete="off"
                spellcheck="false" placeholder="12345678" />
            </label>
            <label>API Hash
              <input id="tg-api-hash" type="password" autocomplete="off" spellcheck="false"
                placeholder="0abc…" />
            </label>
            <button id="btn-keys-next" type="button">Next</button>
          </div>

          <!-- Step: phone -->
          <div id="step-phone" class="step">
            <label>Phone number
              <input id="tg-phone" type="tel" inputmode="tel" autocomplete="tel"
                placeholder="+15551234567" />
            </label>
            <button id="btn-send-code" type="button">Send code</button>
          </div>

          <!-- Step: code -->
          <div id="step-code" class="step">
            <label>Login code
              <input id="tg-code" type="text" inputmode="numeric" autocomplete="one-time-code"
                placeholder="12345" />
            </label>
            <button id="btn-verify" type="button">Verify</button>
          </div>

          <!-- Step: password (2FA) -->
          <div id="step-password" class="step">
            <label>Two-factor password
              <input id="tg-pw" type="password" autocomplete="current-password" />
            </label>
            <button id="btn-unlock" type="button">Unlock</button>
          </div>

          <!-- Step: connected -->
          <div id="step-connected" class="step">
            <div id="tg-connected-name" class="tg-connected"></div>
            <p class="security-note">
              Logging out asks Telegram to revoke this app session and clears the local session
              string. If revocation cannot be confirmed, remove it from Telegram Settings → Devices.
            </p>
            <button id="btn-logout" type="button" class="ghost">Log out &amp; revoke session</button>
          </div>

          <div id="tg-status" class="tg-status"></div>
        </div>

        <!-- ── Conversations ── -->
        <div class="conv-section">
          <div class="conv-head">
            <span class="conv-section-title">Conversations</span>
            <span id="conv-count" class="conv-count"></span>
          </div>
          <div class="conv-controls">
            <input id="conv-search" type="text" autocomplete="off" spellcheck="false"
              placeholder="Search conversations…" />
            <button id="conv-refresh" type="button" class="ghost small">Refresh</button>
          </div>
          <div id="conv-status" class="conv-status"></div>
          <div id="conv-list" class="conv-list"></div>
        </div>

        <div class="actions">
          <button id="save" type="button">Save</button>
          <span id="saved" class="saved"></span>
        </div>
      </details>

      <footer>Tap temple to talk · tap to send · double-tap to cancel.</footer>
    </main>
  `

  // ── Wire up DOM refs ──────────────────────────────────────────────────────
  statusEl = app.querySelector<HTMLDivElement>('#status')!
  savedEl = app.querySelector<HTMLSpanElement>('#saved')!

  sonioxInput = app.querySelector<HTMLInputElement>('#soniox')!

  convSearchInput = app.querySelector<HTMLInputElement>('#conv-search')!
  convRefreshBtn = app.querySelector<HTMLButtonElement>('#conv-refresh')!
  convCountEl = app.querySelector<HTMLSpanElement>('#conv-count')!
  convStatusEl = app.querySelector<HTMLDivElement>('#conv-status')!
  convListEl = app.querySelector<HTMLDivElement>('#conv-list')!

  stepperEl = app.querySelector<HTMLDivElement>('#tg-stepper')!
  stepKeys = app.querySelector<HTMLDivElement>('#step-keys')!
  stepPhone = app.querySelector<HTMLDivElement>('#step-phone')!
  stepCode = app.querySelector<HTMLDivElement>('#step-code')!
  stepPassword = app.querySelector<HTMLDivElement>('#step-password')!
  stepConnected = app.querySelector<HTMLDivElement>('#step-connected')!

  apiIdInput = app.querySelector<HTMLInputElement>('#tg-api-id')!
  apiHashInput = app.querySelector<HTMLInputElement>('#tg-api-hash')!
  phoneInput = app.querySelector<HTMLInputElement>('#tg-phone')!
  codeInput = app.querySelector<HTMLInputElement>('#tg-code')!
  pwInput = app.querySelector<HTMLInputElement>('#tg-pw')!
  tgStatusEl = app.querySelector<HTMLDivElement>('#tg-status')!
  connectedNameEl = app.querySelector<HTMLDivElement>('#tg-connected-name')!

  // ── Populate initial values ───────────────────────────────────────────────
  sonioxInput.value = initial.sonioxKey
  apiIdInput.value = initial.tgApiId
  apiHashInput.value = initial.tgApiHash

  // Show the correct initial wizard step.
  const initialStep: Step = initial.tgSession ? 'connected' : 'keys'
  if (initial.tgSession) {
    connectedNameEl.textContent = '✅ Connected'
  }
  showStep(initialStep)
  updateConvAvailability()

  // ── Conversations handlers ────────────────────────────────────────────────
  convSearchInput.addEventListener('input', renderConversations)
  convRefreshBtn.addEventListener('click', () => void refreshDialogs())
  convListEl.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('.conv-row')
    if (!btn) return
    const id = btn.getAttribute('data-id')
    if (!id) return
    const existing = pins.find((p) => p.id === id)
    if (existing) {
      pins = togglePin(pins, existing)
    } else {
      if (!canPinMore(pins)) return
      const d = allDialogs.find((x) => x.id === id)
      if (!d) return
      pins = togglePin(pins, { id: d.id, title: d.title, kind: d.kind, isForum: d.isForum })
    }
    renderConversations()
  })

  // ── Wizard button handlers ────────────────────────────────────────────────

  // Step 'keys' → 'phone'
  app.querySelector<HTMLButtonElement>('#btn-keys-next')!.addEventListener('click', () => {
    const apiId = apiIdInput.value.trim()
    const apiHash = apiHashInput.value.trim()
    if (!apiId || Number(apiId) <= 0) {
      setTgStatus('error', 'Enter a valid API ID (number from my.telegram.org).')
      return
    }
    if (!apiHash) {
      setTgStatus('error', 'Enter your API Hash.')
      return
    }
    showStep('phone')
  })

  // Step 'phone' → triggers login flow
  app.querySelector<HTMLButtonElement>('#btn-send-code')!.addEventListener('click', () => {
    const phone = phoneInput.value.trim()
    if (!phone) {
      setTgStatus('error', 'Enter your phone number (e.g. +15551234567).')
      return
    }

    const creds: TgCredentials = {
      apiId: Number(apiIdInput.value.trim()),
      apiHash: apiHashInput.value.trim(),
      session: '',
    }

    const prompts: LoginPrompts = {
      phoneNumber: async () => phoneInput.value.trim(),
      phoneCode: async () => {
        showStep('code')
        return new Promise<string>((r) => {
          resolveCode = r
        })
      },
      password: async () => {
        showStep('password')
        return new Promise<string>((r) => {
          resolvePassword = r
        })
      },
      onError: (e: unknown) => setTgStatus('error', String(e)),
    }

    setTgStatus('', 'Sending code…')
    handlers
      .onTgLogin(creds, prompts)
      .then((username) => {
        // currentSession is updated by the controller via handle.updateSession()
        // before or after this .then() runs; the Save button closure always reads
        // the current module-level value, so order doesn't matter.
        connectedNameEl.textContent = `✅ Connected as @${username}`
        showStep('connected')
        flashSaved('Connected')
        updateConvAvailability() // now connected → load dialogs for pinning
      })
      .catch((err: unknown) => {
        setTgStatus('error', String(err))
      })
  })

  // Step 'code' — resolve the pending phoneCode promise
  app.querySelector<HTMLButtonElement>('#btn-verify')!.addEventListener('click', () => {
    const code = codeInput.value.trim()
    if (!code) {
      setTgStatus('error', 'Enter the code you received.')
      return
    }
    if (resolveCode) {
      resolveCode(code)
      resolveCode = null
    }
  })

  // Step 'password' — resolve the pending password promise
  app.querySelector<HTMLButtonElement>('#btn-unlock')!.addEventListener('click', () => {
    if (resolvePassword) {
      resolvePassword(pwInput.value)
      resolvePassword = null
    }
  })

  // Step 'connected' — revoke the Telegram authorization and clear local session material.
  const logoutBtn = app.querySelector<HTMLButtonElement>('#btn-logout')!
  logoutBtn.addEventListener('click', () => {
    const ok = window.confirm(
      'Log out of Telegram on this device? ERGram will ask Telegram to revoke this app session and clear the local session string.',
    )
    if (!ok) return

    logoutBtn.disabled = true
    setTgStatus('', 'Revoking Telegram session…')
    handlers
      .onTgLogout()
      .then((result) => {
        currentSession = ''
        apiIdInput.value = ''
        apiHashInput.value = ''
        phoneInput.value = ''
        codeInput.value = ''
        pwInput.value = ''
        connectedNameEl.textContent = ''
        showStep('keys')
        setTgStatus(result.revoked ? 'ok' : 'error', result.message)
        flashSaved(result.revoked ? 'Logged out' : 'Cleared locally')
        updateConvAvailability() // disconnected → hide dialog controls
      })
      .catch((err: unknown) => {
        setTgStatus('error', `Logout failed: ${(err as Error)?.message ?? err}`)
      })
      .finally(() => {
        logoutBtn.disabled = false
      })
  })

  // ── Save button ───────────────────────────────────────────────────────────
  app.querySelector<HTMLButtonElement>('#save')!.addEventListener('click', () => {
    handlers.onSave({
      sonioxKey: sonioxInput.value,
      tgApiId: apiIdInput.value,
      tgApiHash: apiHashInput.value,
      tgSession: currentSession, // never typed; preserved from login or initial load
      pinnedConversations: pins,
    })
  })

  injectStyles()

  return {
    updateSession(session: string): void {
      currentSession = session
    },
  }
}

// ── Exported runtime controls ─────────────────────────────────────────────────

export function flashSaved(text = 'Saved'): void {
  if (!savedEl) return
  savedEl.textContent = text
  window.setTimeout(() => {
    if (savedEl.textContent === text) savedEl.textContent = ''
  }, 1800)
}

export function setStatus(kind: Status, text: string): void {
  if (!statusEl) return
  statusEl.className = `status status-${kind}`
  statusEl.textContent = text
}

// ── Styles ────────────────────────────────────────────────────────────────────

function injectStyles(): void {
  // "Light Glass" — mirrors the Auris PWA so this reads as a first-party Even Hub
  // page: light gray canvas, white cards, dark text, black pill CTAs, coral accent.
  const css = `
    :root { color-scheme: light; }
    html, body { margin: 0; min-height: 100%; background: #f2f2f7; color: #1c1c1e;
      font: 16px/1.45 -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto,
        'Helvetica Neue', Arial, sans-serif;
      touch-action: manipulation; -webkit-text-size-adjust: 100%; overscroll-behavior: none; }
    #app { display: flex; min-height: 100%; }
    .panel { display: flex; flex-direction: column; gap: 16px;
      width: 100%; max-width: 560px; margin: 0 auto; padding: 20px 16px 40px; box-sizing: border-box; }
    header { display: flex; align-items: center; justify-content: space-between; padding: 4px 4px 0; }
    h1 { font-size: 22px; font-weight: 700; margin: 0; letter-spacing: -0.01em; }
    .status { font-size: 12px; padding: 5px 11px; border-radius: 999px; font-weight: 600;
      letter-spacing: 0.02em; }
    .status-idle      { color: #6e6e73; background: #e9e9ee; }
    .status-listening { color: #b25334; background: #fbe7df; }
    .status-thinking  { color: #8a6d00; background: #fff5c7; }
    .status-error     { color: #c5363b; background: #ffe2e3; }

    details.settings { background: #ffffff; border: 1px solid #e5e5ea; border-radius: 12px;
      padding: 14px 16px; box-shadow: 0 1px 2px rgba(0,0,0,0.04); }
    details.settings summary { cursor: pointer; font-size: 13px; color: #6e6e73; font-weight: 600;
      text-transform: uppercase; letter-spacing: 0.04em; }
    details.settings[open] summary { margin-bottom: 14px; }
    label { display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: #6e6e73;
      font-weight: 500; margin-bottom: 14px; }
    .field-hint { font-size: 11px; color: #8e8e93; font-weight: 400; }
    input { background: #ffffff; color: #1c1c1e; border: 1px solid #d1d1d6; border-radius: 10px;
      padding: 11px 13px; font-size: 16px; font-family: inherit; -webkit-appearance: none; box-sizing: border-box; }
    input:focus { outline: none; border-color: #d97757; box-shadow: 0 0 0 3px rgba(217,119,87,0.18); }

    /* Telegram wizard */
    .tg-section { margin: 4px 0 14px; padding-top: 12px; border-top: 1px solid #e5e5ea; }
    .tg-section-head { font-size: 12px; color: #6e6e73; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.04em; margin: 0 0 8px; }
    .tg-stepper { font-size: 11px; color: #8e8e93; margin-bottom: 10px; }
    .security-note { margin: 0 0 12px; padding: 10px 12px; border-radius: 10px;
      background: #fff5c7; color: #6a5300; font-size: 12px; line-height: 1.45; font-weight: 500; }
    .step { display: none; }
    .step.active { display: block; }
    .step-hint { font-size: 13px; color: #6e6e73; margin: 0 0 12px; line-height: 1.5; }
    .step-hint a { color: #d97757; font-weight: 600; text-decoration: none; }
    .tg-status { font-size: 12px; min-height: 18px; margin-top: 8px; color: #6e6e73; }
    .tg-status-error { color: #c5363b; }
    .tg-status-ok { color: #2ea043; }
    .tg-connected { font-size: 15px; font-weight: 600; color: #1c1c1e; margin-bottom: 12px; }

    /* Conversations */
    .conv-section { margin: 4px 0 14px; padding-top: 12px; border-top: 1px solid #e5e5ea; }
    .conv-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 10px; }
    .conv-section-title { font-size: 12px; color: #6e6e73; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.04em; }
    .conv-count { font-size: 11px; color: #8e8e93; font-weight: 600; }
    .conv-controls { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; }
    .conv-controls input { flex: 1; margin: 0; }
    button.small { padding: 8px 12px; font-size: 13px; border-radius: 10px; }
    .conv-status { font-size: 12px; min-height: 16px; color: #6e6e73; margin-bottom: 8px; }
    .conv-status-error { color: #c5363b; }
    .conv-list { display: flex; flex-direction: column; gap: 6px; max-height: 320px; overflow-y: auto; }
    .conv-row { display: flex; align-items: center; gap: 10px; width: 100%; text-align: left;
      background: #ffffff; color: #1c1c1e; border: 1px solid #e5e5ea; border-radius: 10px;
      padding: 10px 12px; font-size: 15px; font-weight: 500; }
    .conv-row:active { background: #f2f2f7; }
    .conv-row.pinned { border-color: #d97757; }
    .conv-row.disabled { opacity: 0.45; }
    .conv-star { font-size: 18px; color: #d97757; width: 18px; text-align: center; flex: none; }
    .conv-row:not(.pinned) .conv-star { color: #c7c7cc; }
    .conv-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .conv-empty { font-size: 13px; color: #8e8e93; padding: 8px 2px; }

    .actions { display: flex; align-items: center; gap: 12px; margin-top: 4px; }
    button { background: #000000; color: #ffffff; border: none; border-radius: 14px;
      padding: 12px 20px; font-size: 15px; font-weight: 600; cursor: pointer; font-family: inherit; }
    button:active { background: #2c2c2e; }
    button.ghost { background: transparent; color: #d97757; border: 1px solid #d1d1d6; }
    button.ghost:active { background: #f2f2f7; }
    .saved { font-size: 13px; color: #2ea043; font-weight: 600; }

    footer { font-size: 12px; color: #8e8e93; text-align: center; padding: 4px 8px; }
  `
  const style = document.createElement('style')
  style.textContent = css
  document.head.appendChild(style)
}
