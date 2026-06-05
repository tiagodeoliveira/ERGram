// Classify Telegram dialogs into the shape the conversation picker needs, and
// filter them down to the ones you can actually pin (post to).
//
// `classifyDialog` takes a MINIMAL entity shape rather than a GramJS class so it
// stays pure and unit-testable (same approach as senderLabel in telegram/
// messages.ts). The client maps real GramJS dialogs onto RawDialog.

import type { PinKind } from './pins'

export interface Dialog {
  id: string
  title: string
  kind: PinKind
  isForum: boolean
  postable: boolean
}

/** The slice of a GramJS dialog/entity we read. */
export interface RawDialog {
  id: string
  title: string
  entity: {
    className: string
    bot?: boolean // User
    megagroup?: boolean // Channel → supergroup
    broadcast?: boolean // Channel → broadcast
    forum?: boolean // Channel → forum (topics)
    creator?: boolean // we created it
    adminRights?: { postMessages?: boolean }
    left?: boolean // no longer a member
    deactivated?: boolean // Chat tombstone
  } | null
}

export function classifyDialog(d: RawDialog): Dialog | null {
  const e = d.entity
  if (!e) return null

  const base = { id: d.id, title: d.title }

  switch (e.className) {
    case 'User':
      return { ...base, kind: e.bot ? 'bot' : 'user', isForum: false, postable: true }

    case 'Chat':
      return {
        ...base,
        kind: 'group',
        isForum: false,
        postable: !e.left && !e.deactivated,
      }

    case 'Channel':
      if (e.megagroup) {
        return { ...base, kind: 'group', isForum: Boolean(e.forum), postable: !e.left }
      }
      // Broadcast channel: only postable if you can post.
      return {
        ...base,
        kind: 'channel',
        isForum: false,
        postable: Boolean(e.creator || e.adminRights?.postMessages) && !e.left,
      }

    default:
      // ChatForbidden, ChannelForbidden, ChatEmpty, etc. — not selectable.
      return null
  }
}

export function pinnableDialogs(dialogs: Dialog[]): Dialog[] {
  return dialogs.filter((d) => d.postable)
}

export function filterDialogs(dialogs: Dialog[], query: string): Dialog[] {
  const q = query.trim().toLowerCase()
  if (!q) return dialogs
  return dialogs.filter((d) => d.title.toLowerCase().includes(q))
}
