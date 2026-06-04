import { describe, expect, it } from 'vitest'
import { activeTopicFromForumTopic, MAIN_CHAT_TOPIC, shouldShowTopicPicker } from './topic-selection'

const topic = (id: number, title: string) => ({ id, title })

describe('topic selection workflow', () => {
  it('enters the main chat directly when a group has no forum topics', () => {
    expect(shouldShowTopicPicker([])).toBe(false)
    expect(MAIN_CHAT_TOPIC).toEqual({ topicId: 1, title: 'Main chat', threadId: undefined })
  })

  it('targets the main chat without a forum reply thread', () => {
    expect(MAIN_CHAT_TOPIC.threadId).toBeUndefined()
  })

  it('shows the topic picker when a group has forum topics', () => {
    expect(shouldShowTopicPicker([topic(42, 'Support')])).toBe(true)
  })

  it('targets selected forum topics by their thread id', () => {
    expect(activeTopicFromForumTopic(topic(42, 'Support'))).toEqual({
      topicId: 42,
      title: 'Support',
      threadId: 42,
    })
  })
})
