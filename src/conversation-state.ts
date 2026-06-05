// Per-conversation chat state. Generalizes the old single-group topic-state to
// many pinned conversations: histories are keyed by a composite (chatId, topicId)
// so the same topicId (e.g. 1 = main chat) in different chats never collides.

import { upsertMsg, type Msg } from './conversation'
import type { TgMessage } from './telegram/messages'

export interface ActiveRef {
  chatId: string
  topicId: number
}

export function convKey(chatId: string, topicId: number): string {
  return `${chatId}:${topicId}`
}

export function historyFor(histories: Map<string, Msg[]>, chatId: string, topicId: number): Msg[] {
  const key = convKey(chatId, topicId)
  let h = histories.get(key)
  if (!h) {
    h = []
    histories.set(key, h)
  }
  return h
}

/**
 * Route an incoming message. Accepts it only if its chat is pinned; stores it in
 * the (chatId, topicId) log (so replies to inactive conversations are waiting on
 * switch-back). Returns true when the message lands in the currently active
 * (chat, topic), i.e. the visible view needs a repaint.
 */
export function applyIncomingMessage(
  histories: Map<string, Msg[]>,
  pinnedIds: Set<string>,
  active: ActiveRef | null,
  m: TgMessage,
): boolean {
  if (!pinnedIds.has(m.chatId)) return false

  const text = m.text.trim()
  if (!text) return false

  const log = historyFor(histories, m.chatId, m.topicId)
  upsertMsg(log, { id: m.id, from: m.from, text, mine: m.mine })

  return active?.chatId === m.chatId && active?.topicId === m.topicId
}

export function shouldRefreshHistoryOnTopicSwitch(_existingHistory: Msg[]): boolean {
  return true
}
