import '../buffer-global' // MUST be first — sets the global Buffer GramJS needs
import { TelegramClient, Api } from 'telegram'
import { StringSession } from 'telegram/sessions'
import { NewMessage, NewMessageEvent } from 'telegram/events'
import { EditedMessage, EditedMessageEvent } from 'telegram/events/EditedMessage'
import type { TgMessage } from './messages'
import { normalizeForumTopics, type Topic } from './topics'

export interface TgCredentials {
  apiId: number
  apiHash: string
  session: string
}

export interface LoginPrompts {
  phoneNumber: () => Promise<string>
  phoneCode: () => Promise<string>
  password: () => Promise<string>
  onError: (e: unknown) => void
}

export class TgClient {
  readonly client: TelegramClient
  private _meId: bigint | null = null
  /** The logged-in account's user id, available after login/resume. */
  get meId(): bigint | null { return this._meId }

  constructor(cfg: TgCredentials) {
    this.client = new TelegramClient(new StringSession(cfg.session), cfg.apiId, cfg.apiHash, {
      connectionRetries: 3,
      useWSS: true,
    })
  }

  /** Reconnect using a saved session (no login UI). Returns true if authorized. */
  async resume(): Promise<boolean> {
    await this.client.connect()
    const ok = await this.client.isUserAuthorized()
    if (ok) this._meId = BigInt((await this.client.getMe()).id.toString())
    return ok
  }

  /** Interactive first login. Resolves once authorized; prompts drive the steps. */
  async login(prompts: LoginPrompts): Promise<void> {
    await this.client.start({
      phoneNumber: prompts.phoneNumber,
      phoneCode: prompts.phoneCode,
      password: prompts.password,
      onError: prompts.onError,
    })
    this._meId = BigInt((await this.client.getMe()).id.toString())
  }

  saveSession(): string {
    return this.client.session.save() as unknown as string
  }

  async disconnect(): Promise<void> {
    await this.client.disconnect()
  }

  /** List the group's forum topics (for the glasses picker). */
  async getForumTopics(groupId: string, limit = 100): Promise<Topic[]> {
    const entity = await this.client.getInputEntity(groupId)
    const res = await this.client.invoke(
      new Api.channels.GetForumTopics({
        channel: entity,
        limit,
        offsetDate: 0,
        offsetId: 0,
        offsetTopic: 0,
      }),
    )
    return normalizeForumTopics(res)
  }

  /** Send text into a forum topic (or the chat if threadId is undefined). */
  async sendToTopic(chatId: string, threadId: number | undefined, text: string): Promise<void> {
    const opts: Record<string, unknown> = { message: text }
    if (threadId) opts.replyTo = threadId
    await this.client.sendMessage(chatId, opts)
  }

  /** Newest-last list of normalized messages for a topic. */
  async getTopicHistory(
    chatId: string,
    threadId: number | undefined,
    limit: number,
  ): Promise<TgMessage[]> {
    const opts: Record<string, unknown> = { limit }
    if (threadId) opts.replyTo = threadId
    const raw = await this.client.getMessages(chatId, opts)
    return [...raw].reverse().map((m) => this.normalize(m))
  }

  /** Subscribe to new + edited messages. Returns an unsubscribe fn. */
  subscribe(onMessage: (m: TgMessage) => void): () => void {
    const newHandler = (event: NewMessageEvent): void => {
      onMessage(this.normalize(event.message))
    }
    const editedHandler = (event: EditedMessageEvent): void => {
      onMessage(this.normalize(event.message))
    }

    const newBuilder = new NewMessage({})
    const editedBuilder = new EditedMessage({})

    this.client.addEventHandler(newHandler, newBuilder)
    this.client.addEventHandler(editedHandler, editedBuilder)

    return () => {
      this.client.removeEventHandler(newHandler, newBuilder)
      this.client.removeEventHandler(editedHandler, editedBuilder)
    }
  }

  private normalize(m: unknown): TgMessage {
    const x = m as {
      id: number
      message?: string
      out?: boolean
      date?: number
      sender?: { bot?: boolean }
    }
    return {
      id: x.id,
      text: x.message || '',
      mine: Boolean(x.out),
      bot: Boolean(x.sender?.bot),
      date: x.date || 0,
    }
  }
}
