// Persistent app settings — Soniox key + Telegram credentials.
//
// Storage: the Even App WebView is a Flutter WebView where browser
// localStorage/IndexedDB are NOT reliable across restarts. The SDK's
// `setLocalStorage`/`getLocalStorage` (which persist into the Even Realities
// app itself) are the only durable store. See device-features skill.
//
// All values are entered in the app's settings panel (the onboarding wizard) —
// there is no env/build-time configuration.

export interface Settings {
  /** Soniox API key (real-time STT). */
  sonioxKey: string
  /** Telegram API id (numeric, stored as string in the form; parse at use). */
  tgApiId: string
  /** Telegram API hash. */
  tgApiHash: string
  /** GramJS session string — empty until the user has logged in once. */
  tgSession: string
  /** Telegram supergroup id, e.g. -1001234567890 (from Telegram UI). */
  tgGroupId: string
}

/** Minimal slice of the SDK bridge that settings persistence needs. */
export interface SettingsStore {
  getLocalStorage(key: string): Promise<string>
  setLocalStorage(key: string, value: string): Promise<boolean>
}

const KEYS = {
  sonioxKey: 'ergram.soniox_key',
  tgApiId: 'ergram.tg_api_id',
  tgApiHash: 'ergram.tg_api_hash',
  tgSession: 'ergram.tg_session',
  tgGroupId: 'ergram.tg_group_id',
  activeTopic: 'ergram.active_topic',
} as const

export const EMPTY_SETTINGS: Settings = {
  sonioxKey: '',
  tgApiId: '',
  tgApiHash: '',
  tgSession: '',
  tgGroupId: '',
}

/** Load saved settings from the on-device store (empty strings until saved). */
export async function loadSettings(store: SettingsStore): Promise<Settings> {
  const [sonioxKey, tgApiId, tgApiHash, tgSession, tgGroupId] = await Promise.all([
    store.getLocalStorage(KEYS.sonioxKey),
    store.getLocalStorage(KEYS.tgApiId),
    store.getLocalStorage(KEYS.tgApiHash),
    store.getLocalStorage(KEYS.tgSession),
    store.getLocalStorage(KEYS.tgGroupId),
  ])

  return {
    sonioxKey: sonioxKey || '',
    tgApiId: tgApiId || '',
    tgApiHash: tgApiHash || '',
    tgSession: tgSession || '',
    tgGroupId: tgGroupId || '',
  }
}

/** Persist all settings. Trims whitespace so a stray space can't break a key. */
export async function saveSettings(store: SettingsStore, s: Settings): Promise<void> {
  await Promise.all([
    store.setLocalStorage(KEYS.sonioxKey, s.sonioxKey.trim()),
    store.setLocalStorage(KEYS.tgApiId, s.tgApiId.trim()),
    store.setLocalStorage(KEYS.tgApiHash, s.tgApiHash.trim()),
    store.setLocalStorage(KEYS.tgSession, s.tgSession.trim()),
    store.setLocalStorage(KEYS.tgGroupId, s.tgGroupId.trim()),
  ])
}

/** PTT/STT only needs a Soniox key. */
export function canTranscribe(s: Settings): boolean {
  return s.sonioxKey.trim().length > 0
}

/** Telegram is ready when the session string + api id + api hash are all present. */
export function hasTelegram(s: Settings): boolean {
  return s.tgSession.trim().length > 0 && Number(s.tgApiId) > 0 && s.tgApiHash.trim().length > 0
}

/** Full chat requires STT + a live Telegram session + a target group. */
export function canChat(s: Settings): boolean {
  return canTranscribe(s) && hasTelegram(s) && s.tgGroupId.trim().length > 0
}

/** The forum topic id last active on the glasses (null if never set). */
export async function loadActiveTopicId(store: SettingsStore): Promise<number | null> {
  const raw = (await store.getLocalStorage(KEYS.activeTopic)) || ''
  const n = Number(raw)
  return raw && Number.isFinite(n) ? n : null
}

export async function saveActiveTopicId(store: SettingsStore, id: number): Promise<void> {
  await store.setLocalStorage(KEYS.activeTopic, String(id))
}
