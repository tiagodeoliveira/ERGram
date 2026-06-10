import { describe, it, expect } from 'vitest'
import { senderLabel, topicIdOf, messagesToLog, type TgMessage } from './messages'

describe('senderLabel', () => {
  it('prefers a non-empty first name', () => {
    expect(senderLabel({ firstName: 'Alice', username: 'al', bot: false })).toBe('Alice')
  })
  it('falls back to @username when first name is blank', () => {
    expect(senderLabel({ firstName: '   ', username: 'al' })).toBe('@al')
  })
  it('uses @username when there is no first name', () => {
    expect(senderLabel({ username: 'bob' })).toBe('@bob')
  })
  it('labels bots with no name/username as Bot', () => {
    expect(senderLabel({ bot: true })).toBe('Bot')
  })
  it('labels unknown humans as Someone', () => {
    expect(senderLabel({})).toBe('Someone')
  })
})

describe('topicIdOf', () => {
  it('prefers replyToTopId (reply within a topic)', () => {
    expect(topicIdOf({ replyToTopId: 55, replyToMsgId: 10 })).toBe(55)
  })
  it('uses replyToMsgId only when Telegram marks the header as a forum topic', () => {
    expect(topicIdOf({ replyToMsgId: 10, forumTopic: true })).toBe(10)
  })
  it('keeps ordinary non-forum replies in the main chat route', () => {
    expect(topicIdOf({ replyToMsgId: 10 })).toBe(1)
  })
  it('treats a missing reply header as the General topic (1)', () => {
    expect(topicIdOf(undefined)).toBe(1)
    expect(topicIdOf({})).toBe(1)
  })
})

describe('messagesToLog', () => {
  const tg = (over: Partial<TgMessage>): TgMessage => ({
    id: 0,
    text: '',
    mine: false,
    bot: false,
    from: '',
    chatId: '-100',
    topicId: 5,
    date: 0,
    ...over,
  })

  it('drops empty/whitespace (service) messages and trims text', () => {
    const out = messagesToLog([
      tg({ id: 1, text: 'hi', from: 'Alice' }),
      tg({ id: 2, text: '   ' }),
      tg({ id: 3, text: ' yo ', mine: true, from: '' }),
    ])
    expect(out).toEqual([
      { id: 1, from: 'Alice', text: 'hi', mine: false },
      { id: 3, from: '', text: 'yo', mine: true },
    ])
  })

  it('preserves order', () => {
    const out = messagesToLog([
      tg({ id: 1, text: 'a', from: 'A' }),
      tg({ id: 2, text: 'b', from: 'B' }),
    ])
    expect(out.map((m) => m.id)).toEqual([1, 2])
  })
})
