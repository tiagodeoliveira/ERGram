import { describe, it, expect } from 'vitest'
import { senderLabel, topicIdOf } from './messages'

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
  it('falls back to replyToMsgId (top-level message in a topic)', () => {
    expect(topicIdOf({ replyToMsgId: 10 })).toBe(10)
  })
  it('treats a missing reply header as the General topic (1)', () => {
    expect(topicIdOf(undefined)).toBe(1)
    expect(topicIdOf({})).toBe(1)
  })
})
