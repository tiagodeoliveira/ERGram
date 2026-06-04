import { describe, it, expect } from 'vitest'
import { applyIncomingMessage, shouldRefreshHistoryOnTopicSwitch } from './topic-state'
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

const msg = (id: number, text: string, from = 'Hermes', mine = false): Msg => ({ id, text, from, mine })

describe('applyIncomingMessage', () => {
  it('stores messages for inactive topics so final replies are waiting when the user switches back', () => {
    const histories = new Map<number, Msg[]>([[10, [msg(1, 'earlier')]]])

    const changedActive = applyIncomingMessage(histories, { topicId: 10 }, '-100123', tg({ id: 2, topicId: 20, text: 'final answer' }))

    expect(changedActive).toBe(false)
    expect(histories.get(20)).toEqual([msg(2, 'final answer')])
    expect(histories.get(10)).toEqual([msg(1, 'earlier')])
  })

  it('returns true only when the visible active topic changed', () => {
    const histories = new Map<number, Msg[]>()

    expect(applyIncomingMessage(histories, { topicId: 10 }, '-100123', tg({ id: 1, topicId: 10 }))).toBe(true)
    expect(applyIncomingMessage(histories, { topicId: 10 }, '-100123', tg({ id: 2, topicId: 11 }))).toBe(false)
  })

  it('ignores messages from other groups and empty service messages', () => {
    const histories = new Map<number, Msg[]>()

    expect(applyIncomingMessage(histories, { topicId: 10 }, '-100123', tg({ chatId: '-100999' }))).toBe(false)
    expect(applyIncomingMessage(histories, { topicId: 10 }, '-100123', tg({ text: '   ' }))).toBe(false)

    expect(histories.size).toBe(0)
  })
})

describe('shouldRefreshHistoryOnTopicSwitch', () => {
  it('refreshes existing topic logs to backfill replies missed while the app was in another topic or suspended', () => {
    expect(shouldRefreshHistoryOnTopicSwitch([msg(1, 'already shown')])).toBe(true)
  })
})
