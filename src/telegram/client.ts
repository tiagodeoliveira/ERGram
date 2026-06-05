import '../buffer-global' // MUST be first — sets the global Buffer GramJS needs
import { TelegramClient, Api } from 'telegram'
import { StringSession } from 'telegram/sessions'
import { NewMessage, NewMessageEvent } from 'telegram/events'
import { EditedMessage, EditedMessageEvent } from 'telegram/events/EditedMessage'
import { senderLabel, topicIdOf, type TgMessage } from './messages'
import { normalizeForumTopics, type Topic } from './topics'
import { classifyDialog, pinnableDialogs, type Dialog, type RawDialog } from '../dialogs'

// Structural views of the GramJS dialog/entity shapes we read (avoids `any`).
interface RawEntityLike {
  className: string
  bot?: boolean
  megagroup?: boolean
  broadcast?: boolean
  forum?: boolean
  creator?: boolean
  adminRights?: { postMessages?: boolean } | null
  left?: boolean
  deactivated?: boolean
}
interface RawDialogLike {
  id?: { toString(): string }
  title?: string
  name?: string
  entity?: unknown
}

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
  get meId(): bigint | null {
    return this._meId
  }

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

  /** List the account's postable conversations (for the PWA pin list). */
  async getDialogs(limit = 100): Promise<Dialog[]> {
    const dialogs = await this.client.getDialogs({ limit })
    const out: Dialog[] = []
    for (const d of dialogs) {
      const classified = classifyDialog(toRawDialog(d as unknown as RawDialogLike))
      if (classified) out.push(classified)
    }
    return pinnableDialogs(out)
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

  /** Send text into a forum topic (or the chat if threadId is undefined). Returns the sent message id. */
  async sendToTopic(chatId: string, threadId: number | undefined, text: string): Promise<number> {
    const opts: Record<string, unknown> = { message: text }
    if (threadId) opts.replyTo = threadId
    const sent = await this.client.sendMessage(chatId, opts)
    const id = (sent as unknown as { id?: number }).id
    if (typeof id !== 'number') throw new Error('sendMessage returned no message id')
    return id
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
    return Promise.all([...raw].reverse().map((m) => this.normalize(m)))
  }

  /** Subscribe to new + edited messages. Returns an unsubscribe fn. */
  subscribe(onMessage: (m: TgMessage) => void): () => void {
    const newHandler = async (event: NewMessageEvent): Promise<void> => {
      onMessage(await this.normalize(event.message))
    }
    const editedHandler = async (event: EditedMessageEvent): Promise<void> => {
      onMessage(await this.normalize(event.message))
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

  private async normalize(m: unknown): Promise<TgMessage> {
    const x = m as {
      id: number
      message?: string
      out?: boolean
      date?: number
      chatId?: { toString(): string }
      sender?: { firstName?: string; username?: string; bot?: boolean }
      getSender?: () => Promise<
        { firstName?: string; username?: string; bot?: boolean } | undefined
      >
      replyTo?: { replyToTopId?: number; replyToMsgId?: number }
    }

    // Prefer the inlined sender; fetch it only when the update didn't carry one.
    let sender = x.sender
    if (!sender && typeof x.getSender === 'function') {
      try {
        sender = await x.getSender()
      } catch {
        sender = undefined
      }
    }

    const mine = Boolean(x.out)
    return {
      id: x.id,
      text: x.message || '',
      mine,
      bot: Boolean(sender?.bot),
      from: mine ? '' : senderLabel(sender ?? {}),
      chatId: x.chatId?.toString() ?? '',
      topicId: topicIdOf(x.replyTo),
      date: x.date || 0,
    }
  }
}

// Map a GramJS dialog onto the minimal RawDialog that dialogs.ts classifies.
// `dialog.id` is the marked peer id (same form as TgMessage.chatId), so pins
// route correctly against incoming messages.
function toRawDialog(d: RawDialogLike): RawDialog {
  const e = d.entity as RawEntityLike | undefined
  return {
    id: d.id?.toString() ?? '',
    title: d.title || d.name || '',
    entity: e
      ? {
          className: e.className,
          bot: e.bot,
          megagroup: e.megagroup,
          broadcast: e.broadcast,
          forum: e.forum,
          creator: e.creator,
          adminRights: e.adminRights ? { postMessages: e.adminRights.postMessages } : undefined,
          left: e.left,
          deactivated: e.deactivated,
        }
      : null,
  }
}
