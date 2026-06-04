import type { Topic } from './telegram/topics'

export interface ActiveTopic {
  topicId: number
  title: string
  threadId?: number
}

export const MAIN_CHAT_TOPIC: ActiveTopic = {
  topicId: 1,
  title: 'Main chat',
  threadId: undefined,
}

export function activeTopicFromForumTopic(topic: Topic): ActiveTopic {
  return { topicId: topic.id, title: topic.title, threadId: topic.id }
}

export function shouldShowTopicPicker(topics: Topic[]): boolean {
  return topics.length > 0
}
