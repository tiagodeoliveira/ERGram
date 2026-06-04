import { upsertMsg, type Msg } from './conversation'
import type { TgMessage } from './telegram/messages'

export interface ActiveTopicRef {
  topicId: number
}

function historyFor(histories: Map<number, Msg[]>, id: number): Msg[] {
  let h = histories.get(id)
  if (!h) {
    h = []
    histories.set(id, h)
  }
  return h
}

export function applyIncomingMessage(
  histories: Map<number, Msg[]>,
  active: ActiveTopicRef | null,
  expectedChatId: string,
  m: TgMessage,
): boolean {
  if (m.chatId !== expectedChatId) return false

  const text = m.text.trim()
  if (!text) return false

  const log = historyFor(histories, m.topicId)
  upsertMsg(log, { id: m.id, from: m.from, text, mine: m.mine })

  return active?.topicId === m.topicId
}

export function shouldRefreshHistoryOnTopicSwitch(_existingHistory: Msg[]): boolean {
  return true
}
