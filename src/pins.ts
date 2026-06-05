// A pinned conversation: a Telegram dialog the user has chosen to surface on the
// glasses. Up to MAX_PINS, ordered by when they were pinned (pin order is the
// order shown on the glasses). Persisted as JSON in the settings store.

export type PinKind = 'user' | 'bot' | 'group' | 'channel'

export interface Pin {
  /** Marked chat id, e.g. "-1001234567890" (group) or "123456789" (user). */
  id: string
  /** Snapshot display name; refreshed when the PWA reloads dialogs. */
  title: string
  kind: PinKind
  /** true → selecting it opens a topic picker (forum supergroup). */
  isForum: boolean
}

export const MAX_PINS = 5

export function isPinned(pins: Pin[], id: string): boolean {
  return pins.some((p) => p.id === id)
}

export function canPinMore(pins: Pin[]): boolean {
  return pins.length < MAX_PINS
}

/**
 * Toggle a pin, returning a new array. If present → remove it (others keep their
 * order). If absent and there's room → append it (pin order = glasses order).
 * If absent and at the cap → unchanged (the UI gates this; this is a safety net).
 */
export function togglePin(pins: Pin[], entry: Pin): Pin[] {
  if (isPinned(pins, entry.id)) {
    return pins.filter((p) => p.id !== entry.id)
  }
  if (!canPinMore(pins)) return [...pins]
  return [...pins, entry]
}

export function serializePins(pins: Pin[]): string {
  return JSON.stringify(pins)
}

/**
 * Parse pins from the stored string. Defensive: bad JSON or a non-array yields
 * [], malformed entries are dropped, duplicates collapse to their first
 * occurrence, and the result is clamped to MAX_PINS.
 */
export function parsePins(raw: string): Pin[] {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(data)) return []

  const seen = new Set<string>()
  const pins: Pin[] = []
  for (const entry of data) {
    const pin = coercePin(entry)
    if (!pin || seen.has(pin.id)) continue
    seen.add(pin.id)
    pins.push(pin)
    if (pins.length >= MAX_PINS) break
  }
  return pins
}

const KINDS: readonly PinKind[] = ['user', 'bot', 'group', 'channel']

function coercePin(entry: unknown): Pin | null {
  if (typeof entry !== 'object' || entry === null) return null
  const e = entry as Record<string, unknown>
  if (typeof e.id !== 'string' || typeof e.title !== 'string') return null
  const kind = (KINDS as readonly string[]).includes(e.kind as string)
    ? (e.kind as PinKind)
    : 'user'
  return { id: e.id, title: e.title, kind, isForum: Boolean(e.isForum) }
}
