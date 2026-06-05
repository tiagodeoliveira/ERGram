import { describe, expect, it } from 'vitest'
import {
  classifyDialog,
  pinnableDialogs,
  filterDialogs,
  type Dialog,
  type RawDialog,
} from './dialogs'

const dialog = (id: string, title: string, entity: RawDialog['entity']): RawDialog => ({
  id,
  title,
  entity,
})

describe('classifyDialog', () => {
  it('classifies a human 1:1 as a postable user', () => {
    expect(classifyDialog(dialog('1', 'Alice', { className: 'User' }))).toEqual({
      id: '1',
      title: 'Alice',
      kind: 'user',
      isForum: false,
      postable: true,
    })
  })

  it('classifies a bot as kind "bot"', () => {
    const d = classifyDialog(dialog('2', 'AI bot', { className: 'User', bot: true }))
    expect(d?.kind).toBe('bot')
    expect(d?.postable).toBe(true)
  })

  it('classifies an active basic group as a postable group', () => {
    expect(classifyDialog(dialog('-10', 'Family', { className: 'Chat' }))).toEqual({
      id: '-10',
      title: 'Family',
      kind: 'group',
      isForum: false,
      postable: true,
    })
  })

  it('marks a left or deactivated basic group as not postable', () => {
    expect(classifyDialog(dialog('-10', 'Old', { className: 'Chat', left: true }))?.postable).toBe(
      false,
    )
    expect(
      classifyDialog(dialog('-11', 'Dead', { className: 'Chat', deactivated: true }))?.postable,
    ).toBe(false)
  })

  it('classifies a non-forum supergroup as a postable group', () => {
    const d = classifyDialog(dialog('-100', 'Work', { className: 'Channel', megagroup: true }))
    expect(d).toMatchObject({ kind: 'group', isForum: false, postable: true })
  })

  it('marks a forum supergroup with isForum true', () => {
    const d = classifyDialog(
      dialog('-100', 'Forum', { className: 'Channel', megagroup: true, forum: true }),
    )
    expect(d).toMatchObject({ kind: 'group', isForum: true, postable: true })
  })

  it('marks a supergroup you have left as not postable', () => {
    const d = classifyDialog(
      dialog('-100', 'Gone', { className: 'Channel', megagroup: true, left: true }),
    )
    expect(d?.postable).toBe(false)
  })

  it('classifies a broadcast channel as postable only with post rights', () => {
    const reader = classifyDialog(dialog('-200', 'News', { className: 'Channel', broadcast: true }))
    expect(reader).toMatchObject({ kind: 'channel', isForum: false, postable: false })

    const admin = classifyDialog(
      dialog('-201', 'Mine', {
        className: 'Channel',
        broadcast: true,
        adminRights: { postMessages: true },
      }),
    )
    expect(admin?.postable).toBe(true)

    const creator = classifyDialog(
      dialog('-202', 'Owned', { className: 'Channel', broadcast: true, creator: true }),
    )
    expect(creator?.postable).toBe(true)
  })

  it('returns null for an unresolvable or unknown entity', () => {
    expect(classifyDialog(dialog('1', 'x', null))).toBeNull()
    expect(classifyDialog(dialog('1', 'x', { className: 'ChatForbidden' }))).toBeNull()
  })
})

describe('pinnableDialogs', () => {
  it('keeps only postable dialogs', () => {
    const ds: Dialog[] = [
      { id: '1', title: 'a', kind: 'user', isForum: false, postable: true },
      { id: '2', title: 'b', kind: 'channel', isForum: false, postable: false },
      { id: '3', title: 'c', kind: 'group', isForum: false, postable: true },
    ]
    expect(pinnableDialogs(ds).map((d) => d.id)).toEqual(['1', '3'])
  })
})

describe('filterDialogs', () => {
  const ds: Dialog[] = [
    { id: '1', title: 'Alice', kind: 'user', isForum: false, postable: true },
    { id: '2', title: 'Family group', kind: 'group', isForum: false, postable: true },
    { id: '3', title: 'AI bot', kind: 'bot', isForum: false, postable: true },
  ]

  it('returns all dialogs for an empty or whitespace query', () => {
    expect(filterDialogs(ds, '')).toEqual(ds)
    expect(filterDialogs(ds, '   ')).toEqual(ds)
  })

  it('filters by case-insensitive substring on the title', () => {
    expect(filterDialogs(ds, 'a').map((d) => d.id)).toEqual(['1', '2', '3'])
    expect(filterDialogs(ds, 'family').map((d) => d.id)).toEqual(['2'])
    expect(filterDialogs(ds, 'BOT').map((d) => d.id)).toEqual(['3'])
  })

  it('returns an empty list when nothing matches', () => {
    expect(filterDialogs(ds, 'zzz')).toEqual([])
  })
})
