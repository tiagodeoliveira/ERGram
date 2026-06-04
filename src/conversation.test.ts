import { describe, it, expect } from 'vitest'
import { upsertMsg, removeById, reconcileSend, seedHistory, type Msg } from './conversation'

const msg = (id: number, text: string, from = '', mine = false): Msg => ({ id, from, text, mine })

describe('upsertMsg', () => {
  it('appends a message with a new id', () => {
    const log: Msg[] = []
    upsertMsg(log, msg(1, 'hi'))
    expect(log).toEqual([msg(1, 'hi')])
  })
  it('updates an existing id in place (edit)', () => {
    const log: Msg[] = [msg(1, 'old', 'Alice')]
    upsertMsg(log, msg(1, 'new', 'Alice'))
    expect(log).toEqual([msg(1, 'new', 'Alice')])
    expect(log.length).toBe(1)
  })
})

describe('removeById', () => {
  it('removes the matching entry, leaving others', () => {
    const log: Msg[] = [msg(1, 'a'), msg(2, 'b')]
    removeById(log, 1)
    expect(log).toEqual([msg(2, 'b')])
  })
  it('is a no-op when the id is absent', () => {
    const log: Msg[] = [msg(2, 'b')]
    removeById(log, 99)
    expect(log).toEqual([msg(2, 'b')])
  })
})

describe('reconcileSend', () => {
  it('adopts the real id when no echo arrived yet (resolve-first)', () => {
    const log: Msg[] = [msg(-1, 'sent', '', true)]
    reconcileSend(log, -1, 100)
    expect(log).toEqual([msg(100, 'sent', '', true)])
  })
  it('drops the placeholder when the echo already created the real entry (echo-first)', () => {
    const log: Msg[] = [msg(100, 'sent', '', true), msg(-1, 'sent', '', true)]
    reconcileSend(log, -1, 100)
    expect(log).toEqual([msg(100, 'sent', '', true)])
  })
  it('is a no-op when the placeholder is gone', () => {
    const log: Msg[] = [msg(100, 'sent', '', true)]
    reconcileSend(log, -1, 100)
    expect(log).toEqual([msg(100, 'sent', '', true)])
  })
})

describe('seedHistory', () => {
  it('fills an empty log with fetched history in order', () => {
    const log: Msg[] = []
    seedHistory(log, [msg(1, 'a', 'A'), msg(2, 'b', 'B')])
    expect(log).toEqual([msg(1, 'a', 'A'), msg(2, 'b', 'B')])
  })
  it('keeps a live-arrived message and prepends older history, deduping by id', () => {
    const log: Msg[] = [msg(500, 'live', 'Bob')] // arrived during the fetch await
    seedHistory(log, [msg(480, 'older', 'A'), msg(490, 'old', 'B'), msg(500, 'dup', 'Bob')])
    expect(log).toEqual([msg(480, 'older', 'A'), msg(490, 'old', 'B'), msg(500, 'live', 'Bob')])
  })
})
