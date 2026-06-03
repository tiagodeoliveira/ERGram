// One message in a topic's flat, attributed chat log.
export interface Msg {
  id: number // Telegram message id (>0); optimistic local placeholders use <0
  from: string // sender display label ('' when mine — the renderer shows 'You')
  text: string
  mine: boolean // sent by the logged-in account
}

// Insert by id, or update text/from/mine in place if the id already exists.
// In-place update is how message edits (e.g. a bot streaming a reply) are applied.
export function upsertMsg(log: Msg[], msg: Msg): void {
  const existing = log.find((m) => m.id === msg.id)
  if (existing) {
    existing.text = msg.text
    existing.from = msg.from
    existing.mine = msg.mine
  } else {
    log.push(msg)
  }
}

export function removeById(log: Msg[], id: number): void {
  const i = log.findIndex((m) => m.id === id)
  if (i >= 0) log.splice(i, 1)
}

// Reconcile an optimistic send: `tempId` is the placeholder's local id, `realId`
// is the id Telegram assigned. If the subscribe echo already created the real
// entry, drop the placeholder; otherwise the placeholder adopts the real id so a
// later echo upserts onto it. Safe regardless of which arrives first.
export function reconcileSend(log: Msg[], tempId: number, realId: number): void {
  const temp = log.find((m) => m.id === tempId)
  if (!temp) return
  if (log.some((m) => m.id === realId && m !== temp)) {
    removeById(log, tempId)
  } else {
    temp.id = realId
  }
}
