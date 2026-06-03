import { describe, it, expect } from 'vitest'
import { renderConversation } from './render'
import type { Msg } from '../conversation'

const D = '----------' // stand-in divider (real code passes the light rule)
const m = (from: string, text: string, mine = false): Msg => ({ id: 0, from, text, mine })

describe('renderConversation', () => {
  it('returns empty string for an empty log', () => {
    expect(renderConversation([], D)).toBe('')
  })

  it('labels mine as "You" and others by their from label', () => {
    expect(renderConversation([m('Alice', 'hey'), m('', "what's up", true)], D)).toBe(
      ["Alice: hey", D, "You: what's up"].join('\n'),
    )
  })

  it('groups consecutive same-speaker messages under one name, no rule between', () => {
    const out = renderConversation(
      [m('Alice', 'hey there'), m('', "what's up", true), m('Bob', 'not much'), m('Bob', 'did you see the PR?'), m('Alice', 'yeah, looks good')],
      D,
    )
    expect(out).toBe(
      [
        'Alice: hey there',
        D,
        "You: what's up",
        D,
        'Bob: not much',
        'did you see the PR?',
        D,
        'Alice: yeah, looks good',
      ].join('\n'),
    )
  })

  it('groups consecutive mine messages too', () => {
    expect(renderConversation([m('', 'one', true), m('', 'two', true)], D)).toBe(
      ['You: one', 'two'].join('\n'),
    )
  })
})
