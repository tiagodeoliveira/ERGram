import type { Msg } from '../conversation'

// Render the flat log to a display document. Consecutive messages from the same
// speaker are grouped under a single "Name:" prefix (their following lines carry
// no name); a speaker change inserts the `divider` rule between groups. `mine`
// renders as "You". Returns '' for an empty log (caller supplies an idle hint).
export function renderConversation(msgs: Msg[], divider: string): string {
  const groups: string[][] = []
  let prevKey: string | null = null
  for (const m of msgs) {
    const key = m.mine ? '\x00me' : m.from
    const label = m.mine ? 'You' : m.from
    if (key === prevKey && groups.length) {
      groups[groups.length - 1].push(m.text)
    } else {
      groups.push([`${label}: ${m.text}`])
      prevKey = key
    }
  }
  return groups.map((g) => g.join('\n')).join(`\n${divider}\n`)
}
