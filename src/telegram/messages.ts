import type { Turn } from '../conversation'

// Resolve a display label for a message sender: first name → @username →
// generic ('Bot' for bots, 'Someone' otherwise). Accepts a minimal shape so it
// stays pure and testable independent of GramJS entity types.
export function senderLabel(s: {
  firstName?: string
  username?: string
  bot?: boolean
}): string {
  const first = s.firstName?.trim()
  if (first) return first
  const user = s.username?.trim()
  if (user) return '@' + user
  return s.bot ? 'Bot' : 'Someone'
}

// A normalized Telegram message for rendering.
export interface TgMessage {
  id: number
  text: string
  mine: boolean // sent by the logged-in account (you / the glasses)
  bot: boolean // sent by a bot (the responder in the topic)
  date: number
}

// Fold a chronological message list into chat Turns. A "you" message starts a
// turn; the following bot message(s) become its reply. Non-bot others are shown
// as their own user line. Service messages (empty text) are dropped.
export function messagesToTurns(msgs: TgMessage[]): Turn[] {
  const turns: Turn[] = []
  let pendingUser = ''
  for (const m of msgs) {
    const text = (m.text || '').trim()
    if (!text) continue
    if (m.bot) {
      turns.push({ user: pendingUser, reply: text })
      pendingUser = ''
    } else {
      if (pendingUser) turns.push({ user: pendingUser, reply: '' })
      pendingUser = text
    }
  }
  if (pendingUser) turns.push({ user: pendingUser, reply: '' })
  return turns
}
