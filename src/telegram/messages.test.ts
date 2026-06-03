import { describe, it, expect } from 'vitest'
import { senderLabel } from './messages'

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
