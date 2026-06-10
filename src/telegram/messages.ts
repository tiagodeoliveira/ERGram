import type { Msg } from '../conversation'

// A normalized Telegram message for rendering.
export interface TgMessage {
  id: number
  text: string
  mine: boolean // sent by the logged-in account (you / the glasses)
  bot: boolean // sent by a bot
  from: string // sender display label (see senderLabel); '' when mine
  chatId: string // marked chat id, e.g. "-1001234567890" (for routing)
  topicId: number // forum thread id for forums; 1 for ordinary/non-forum chats
  date: number
}

// Resolve a display label for a message sender: first name → @username →
// generic ('Bot' for bots, 'Someone' otherwise). Accepts a minimal shape so it
// stays pure and testable independent of GramJS entity types.
export function senderLabel(s: { firstName?: string; username?: string; bot?: boolean }): string {
  const first = s.firstName?.trim()
  if (first) return first
  const user = s.username?.trim()
  if (user) return '@' + user
  return s.bot ? 'Bot' : 'Someone'
}

// Forum thread id for a message. Telegram puts the topic root in replyToTopId
// for replies inside a topic. For a topic's top-level post it may only expose
// replyToMsgId, but that is safe to treat as a topic id only when Telegram marks
// the reply header as a forum topic. Ordinary non-forum replies also have
// replyToMsgId; those must stay in the main chat route (topic id 1).
export function topicIdOf(replyTo?: {
  replyToTopId?: number
  replyToMsgId?: number
  forumTopic?: boolean
}): number {
  return replyTo?.replyToTopId ?? (replyTo?.forumTopic ? replyTo.replyToMsgId : undefined) ?? 1
}

// Map a chronological message list to the flat log, dropping empty (service)
// messages and trimming text. No turn-pairing — each message is its own entry.
export function messagesToLog(msgs: TgMessage[]): Msg[] {
  const log: Msg[] = []
  for (const m of msgs) {
    const text = (m.text || '').trim()
    if (!text) continue
    log.push({ id: m.id, from: m.from, text, mine: m.mine })
  }
  return log
}
