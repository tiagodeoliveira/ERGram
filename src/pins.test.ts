import { describe, expect, it } from 'vitest'
import {
  MAX_PINS,
  isPinned,
  canPinMore,
  togglePin,
  serializePins,
  parsePins,
  type Pin,
} from './pins'

const pin = (id: string, title = id, isForum = false): Pin => ({
  id,
  title,
  kind: 'user',
  isForum,
})

describe('isPinned', () => {
  it('reports whether a chat id is in the list', () => {
    const pins = [pin('1'), pin('2')]
    expect(isPinned(pins, '2')).toBe(true)
    expect(isPinned(pins, '3')).toBe(false)
  })
})

describe('canPinMore', () => {
  it('is true below the cap and false at the cap', () => {
    expect(canPinMore([])).toBe(true)
    expect(canPinMore([pin('1'), pin('2'), pin('3'), pin('4')])).toBe(true)
    expect(canPinMore([pin('1'), pin('2'), pin('3'), pin('4'), pin('5')])).toBe(false)
  })
})

describe('togglePin', () => {
  it('appends a new pin at the end (pin order = glasses order)', () => {
    const result = togglePin([pin('1'), pin('2')], pin('3'))
    expect(result.map((p) => p.id)).toEqual(['1', '2', '3'])
  })

  it('removes a pin that is already present, preserving the order of the rest', () => {
    const result = togglePin([pin('1'), pin('2'), pin('3')], pin('2'))
    expect(result.map((p) => p.id)).toEqual(['1', '3'])
  })

  it('does not add beyond the cap', () => {
    const full = [pin('1'), pin('2'), pin('3'), pin('4'), pin('5')]
    const result = togglePin(full, pin('6'))
    expect(result.map((p) => p.id)).toEqual(['1', '2', '3', '4', '5'])
  })

  it('still unpins when at the cap', () => {
    const full = [pin('1'), pin('2'), pin('3'), pin('4'), pin('5')]
    const result = togglePin(full, pin('3'))
    expect(result.map((p) => p.id)).toEqual(['1', '2', '4', '5'])
  })

  it('returns a new array without mutating the input', () => {
    const input = [pin('1')]
    const result = togglePin(input, pin('2'))
    expect(result).not.toBe(input)
    expect(input.map((p) => p.id)).toEqual(['1'])
  })
})

describe('serializePins / parsePins', () => {
  it('round-trips a list of pins', () => {
    const pins = [pin('1', 'Alice'), pin('-100', 'Group', true)]
    expect(parsePins(serializePins(pins))).toEqual(pins)
  })

  it('returns an empty list for malformed JSON', () => {
    expect(parsePins('not json')).toEqual([])
    expect(parsePins('')).toEqual([])
  })

  it('returns an empty list when the JSON is not an array', () => {
    expect(parsePins('{"id":"1"}')).toEqual([])
  })

  it('drops entries with a missing or wrong-typed id/title', () => {
    const raw = JSON.stringify([
      { id: '1', title: 'ok', kind: 'user', isForum: false },
      { id: 2, title: 'numeric id', kind: 'user', isForum: false },
      { title: 'no id', kind: 'user', isForum: false },
      { id: '3' },
    ])
    expect(parsePins(raw).map((p) => p.id)).toEqual(['1'])
  })

  it('clamps to the maximum number of pins', () => {
    const many = Array.from({ length: MAX_PINS + 3 }, (_, i) => pin(String(i)))
    expect(parsePins(serializePins(many))).toHaveLength(MAX_PINS)
  })

  it('de-duplicates by id, keeping the first occurrence', () => {
    const raw = serializePins([pin('1', 'first'), pin('1', 'second'), pin('2')])
    expect(parsePins(raw).map((p) => p.id)).toEqual(['1', '2'])
    expect(parsePins(raw)[0].title).toBe('first')
  })
})
