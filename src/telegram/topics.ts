// A forum topic the user can pick on the glasses.
export interface Topic {
  id: number // the topic's top message id = the thread id used when sending
  title: string
}

// Normalize a GramJS `channels.GetForumTopics` result into Topic[].
// The result has `.topics` (each ForumTopic has `id` + `title`); ignore the
// service "ForumTopicDeleted" entries (no title).
export function normalizeForumTopics(result: unknown): Topic[] {
  const topics = (result as { topics?: Array<{ id?: number; title?: string }> })?.topics ?? []
  return topics
    .filter((t) => typeof t.id === 'number' && typeof t.title === 'string')
    .map((t) => ({ id: t.id as number, title: t.title as string }))
}
