// Persistent app settings — Soniox key + Telegram credentials + pinned conversations.
//
// Storage: the Even App WebView is a Flutter WebView where browser
// localStorage/IndexedDB are NOT reliable across restarts. The SDK's
// `setLocalStorage`/`getLocalStorage` (which persist into the Even Realities
// app itself) are the only durable store. See device-features skill.
//
// All values are entered in the app's settings panel (the onboarding wizard) —
// there is no env/build-time configuration.

import { parsePins, serializePins, type Pin } from './pins'

export interface Settings {
  /** Soniox API key (real-time STT). */
  sonioxKey: string
  /** Telegram API id (numeric, stored as string in the form; parse at use). */
  tgApiId: string
  /** Telegram API hash. */
  tgApiHash: string
  /** GramJS session string — empty until the user has logged in once. */
  tgSession: string
  /** Conversations pinned to the glasses (≤ 5, in pin order). */
  pinnedConversations: Pin[]
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
  pinnedConversations: 'ergram.pinned_conversations',
} as const

export const EMPTY_SETTINGS: Settings = {
  sonioxKey: '',
  tgApiId: '',
  tgApiHash: '',
  tgSession: '',
  pinnedConversations: [],
}

/** Load saved settings from the on-device store (empty until saved). */
export async function loadSettings(store: SettingsStore): Promise<Settings> {
  const [sonioxKey, tgApiId, tgApiHash, tgSession, pinnedRaw] = await Promise.all([
    store.getLocalStorage(KEYS.sonioxKey),
    store.getLocalStorage(KEYS.tgApiId),
    store.getLocalStorage(KEYS.tgApiHash),
    store.getLocalStorage(KEYS.tgSession),
    store.getLocalStorage(KEYS.pinnedConversations),
  ])

  return {
    sonioxKey: sonioxKey || '',
    tgApiId: tgApiId || '',
    tgApiHash: tgApiHash || '',
    tgSession: tgSession || '',
    pinnedConversations: parsePins(pinnedRaw || ''),
  }
}

/** Persist all settings. Trims whitespace so a stray space can't break a key. */
export async function saveSettings(store: SettingsStore, s: Settings): Promise<void> {
  await Promise.all([
    store.setLocalStorage(KEYS.sonioxKey, s.sonioxKey.trim()),
    store.setLocalStorage(KEYS.tgApiId, s.tgApiId.trim()),
    store.setLocalStorage(KEYS.tgApiHash, s.tgApiHash.trim()),
    store.setLocalStorage(KEYS.tgSession, s.tgSession.trim()),
    store.setLocalStorage(KEYS.pinnedConversations, serializePins(s.pinnedConversations)),
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

/** At least one conversation is pinned to the glasses. */
export function hasPins(s: Settings): boolean {
  return s.pinnedConversations.length > 0
}

/** Full chat requires STT + a live Telegram session + at least one pinned conversation. */
export function canChat(s: Settings): boolean {
  return canTranscribe(s) && hasTelegram(s) && hasPins(s)
}
