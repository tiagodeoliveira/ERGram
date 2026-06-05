import { describe, it, expect } from 'vitest'
import {
  convKey,
  historyFor,
  applyIncomingMessage,
  shouldRefreshHistoryOnTopicSwitch,
} from './conversation-state'
import type { Msg } from './conversation'
import type { TgMessage } from './telegram/messages'

const tg = (over: Partial<TgMessage>): TgMessage => ({
  id: 1,
  text: 'hello',
  mine: false,
  bot: false,
  from: 'Hermes',
  chatId: '-100123',
  topicId: 10,
  date: 0,
  ...over,
})

const msg = (id: number, text: string, from = 'Hermes', mine = false): Msg => ({
  id,
  text,
  from,
  mine,
})

const pinned = (...ids: string[]) => new Set(ids)

describe('convKey', () => {
  it('combines chat id and topic id into one map key', () => {
    expect(convKey('-100123', 10)).toBe('-100123:10')
  })
})

describe('historyFor', () => {
  it('creates an empty log on first access and returns the same array thereafter', () => {
    const histories = new Map<string, Msg[]>()
    const a = historyFor(histories, '-100123', 10)
    expect(a).toEqual([])
    a.push(msg(1, 'x'))
    expect(historyFor(histories, '-100123', 10)).toBe(a)
  })
})

describe('applyIncomingMessage', () => {
  it('stores messages for an inactive (chat,topic) so replies are waiting on switch back', () => {
    const histories = new Map<string, Msg[]>([['-100123:10', [msg(1, 'earlier')]]])

    const changedActive = applyIncomingMessage(
      histories,
      pinned('-100123'),
      { chatId: '-100123', topicId: 10 },
      tg({ id: 2, topicId: 20, text: 'final answer' }),
    )

    expect(changedActive).toBe(false)
    expect(histories.get('-100123:20')).toEqual([msg(2, 'final answer')])
    expect(histories.get('-100123:10')).toEqual([msg(1, 'earlier')])
  })

  it('returns true only when both the active chat and topic match', () => {
    const histories = new Map<string, Msg[]>()
    const active = { chatId: '-100123', topicId: 10 }

    expect(applyIncomingMessage(histories, pinned('-100123'), active, tg({ topicId: 10 }))).toBe(
      true,
    )
    expect(
      applyIncomingMessage(histories, pinned('-100123'), active, tg({ id: 2, topicId: 11 })),
    ).toBe(false)
  })

  it('keeps topicId 1 in different chats from colliding (composite keying)', () => {
    const histories = new Map<string, Msg[]>()
    const ids = pinned('-100123', '999')

    applyIncomingMessage(
      histories,
      ids,
      null,
      tg({ id: 1, chatId: '-100123', topicId: 1, text: 'group main' }),
    )
    applyIncomingMessage(
      histories,
      ids,
      null,
      tg({ id: 2, chatId: '999', topicId: 1, text: 'dm', from: 'Alice' }),
    )

    expect(histories.get('-100123:1')).toEqual([msg(1, 'group main')])
    expect(histories.get('999:1')).toEqual([msg(2, 'dm', 'Alice')])
  })

  it('ignores messages from chats that are not pinned', () => {
    const histories = new Map<string, Msg[]>()

    const changed = applyIncomingMessage(
      histories,
      pinned('-100123'),
      { chatId: '-100123', topicId: 10 },
      tg({ chatId: '-100999' }),
    )

    expect(changed).toBe(false)
    expect(histories.size).toBe(0)
  })

  it('ignores empty/service messages even from a pinned chat', () => {
    const histories = new Map<string, Msg[]>()

    expect(
      applyIncomingMessage(
        histories,
        pinned('-100123'),
        { chatId: '-100123', topicId: 10 },
        tg({ text: '   ' }),
      ),
    ).toBe(false)
    expect(histories.size).toBe(0)
  })
})

describe('shouldRefreshHistoryOnTopicSwitch', () => {
  it('refreshes existing logs to backfill replies missed while away', () => {
    expect(shouldRefreshHistoryOnTopicSwitch([msg(1, 'already shown')])).toBe(true)
  })
})
