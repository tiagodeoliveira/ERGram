// Speech-to-text client for the G2 microphone — Soniox real-time WebSocket.
//
// The G2 mic emits PCM s16le @ 16 kHz mono via `bridge.audioControl(true)`.
// Each onEvenHubEvent callback with `audioEvent.audioPcm` delivers a chunk,
// which main.ts forwards here via `sendPcm`. That byte format is exactly what
// Soniox wants (audio_format "pcm_s16le", sample_rate 16000, num_channels 1),
// so we forward frames untouched — no resampling/encoding.
//
// Protocol (https://soniox.com/docs/stt/api-reference/websocket-api):
//   1. open WS to the transcribe endpoint,
//   2. send ONE JSON config frame (api_key + audio/model settings),
//   3. stream raw PCM as binary frames,
//   4. receive JSON { tokens: [{ text, is_final, ... }], ... } messages,
//   5. send an empty frame to finish; server replies { finished: true }.
//
// Token model is *incremental finalization*: every message re-sends the
// unstable tail plus any newly-frozen tokens flagged `is_final`. So we append
// final tokens to an accumulator and REBUILD the interim buffer each message —
// never concatenate whole messages, or words duplicate.

const SONIOX_WS_URL = 'wss://stt-rt.soniox.com/transcribe-websocket'

// Real-time model. If Soniox rejects this name, try 'stt-rt-preview'.
const SONIOX_MODEL = 'stt-rt-v4'

export interface SttSnapshot {
  finalText: string
  interimText: string
  finished: boolean
}

export interface SttClient {
  sendPcm(chunk: Uint8Array): void
  /** Gracefully finish input and wait briefly for Soniox's final tokens. */
  finish(timeoutMs?: number): Promise<SttSnapshot>
  /** Abort/cleanup without waiting for finalization. */
  close(): void
}

interface SonioxToken {
  text: string
  is_final?: boolean
  start_ms?: number
  end_ms?: number
  confidence?: number
  speaker?: string
}

interface SonioxMessage {
  tokens?: SonioxToken[]
  finished?: boolean
  error_code?: number
  error_message?: string
}

// Soniox emits control tokens (e.g. "<end>" for endpoint detection) inline with
// real words. They're signalling, not transcript text — keep them out of the UI.
function isControlToken(text: string): boolean {
  return /^<.*>$/.test(text)
}

export function startSttStream(
  apiKey: string,
  onSnapshot: (snap: SttSnapshot) => void,
  onError?: (err: unknown) => void,
): SttClient {
  if (!apiKey) {
    throw new Error('Soniox API key missing — enter it in settings.')
  }

  const ws = new WebSocket(SONIOX_WS_URL)
  ws.binaryType = 'arraybuffer'

  let open = false
  let closed = false
  let finishing = false
  let endSent = false
  // PCM that arrives before the socket finishes opening — flush on open.
  const pending: Uint8Array[] = []

  // Accumulated confirmed transcript across the whole turn.
  let finalText = ''
  let latest: SttSnapshot = { finalText: '', interimText: '', finished: false }
  let finishPromise: Promise<SttSnapshot> | null = null
  let resolveFinish: ((snap: SttSnapshot) => void) | null = null
  let finishTimer: number | null = null

  function closeSocket(): void {
    closed = true
    if (finishTimer !== null) {
      window.clearTimeout(finishTimer)
      finishTimer = null
    }
    try {
      ws.close()
    } catch {
      /* already closing */
    }
  }

  function emit(snap: SttSnapshot): void {
    latest = snap
    onSnapshot(snap)
    if (snap.finished) settleFinish(snap)
  }

  function settleFinish(snap = latest): void {
    const resolve = resolveFinish
    if (!resolve) return
    if (finishTimer !== null) {
      window.clearTimeout(finishTimer)
      finishTimer = null
    }
    resolveFinish = null
    finishPromise = null
    resolve(snap)
  }

  function sendEndOfInput(): void {
    if (endSent || closed || ws.readyState !== WebSocket.OPEN) return
    endSent = true
    // Empty frame = graceful end-of-input; server flushes + replies finished.
    ws.send(new Uint8Array(0))
  }

  ws.onopen = () => {
    if (closed) {
      closeSocket()
      return
    }

    open = true
    ws.send(
      JSON.stringify({
        api_key: apiKey,
        model: SONIOX_MODEL,
        audio_format: 'pcm_s16le',
        sample_rate: 16000,
        num_channels: 1,
        language_hints: ['en'],
        enable_endpoint_detection: true,
      }),
    )
    for (const chunk of pending) ws.send(chunk)
    pending.length = 0
    if (finishing) sendEndOfInput()
  }

  ws.onmessage = (ev) => {
    let msg: SonioxMessage
    try {
      msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '')
    } catch {
      return
    }

    if (msg.error_code) {
      onError?.(new Error(`Soniox ${msg.error_code}: ${msg.error_message ?? 'error'}`))
      settleFinish(latest)
      closeSocket()
      return
    }

    let interimText = ''
    for (const tok of msg.tokens ?? []) {
      if (!tok.text || isControlToken(tok.text)) continue
      if (tok.is_final) finalText += tok.text
      else interimText += tok.text
    }

    const snap = { finalText, interimText, finished: Boolean(msg.finished) }
    emit(snap)
    if (snap.finished) closeSocket()
  }

  ws.onerror = () => {
    if (!closed) onError?.(new Error('Soniox WebSocket error'))
    settleFinish(latest)
  }

  ws.onclose = () => {
    if (!closed) {
      // Surface an unexpected close (e.g. bad key, network drop) as final state.
      emit({ finalText, interimText: '', finished: true })
    }
    settleFinish(latest)
  }

  return {
    sendPcm(chunk: Uint8Array) {
      if (closed || finishing) return
      if (open && ws.readyState === WebSocket.OPEN) ws.send(chunk)
      else pending.push(chunk)
    },
    finish(timeoutMs = 1500) {
      if (closed) return Promise.resolve(latest)
      if (latest.finished) return Promise.resolve(latest)
      if (finishPromise) return finishPromise

      finishing = true
      finishPromise = new Promise<SttSnapshot>((resolve) => {
        resolveFinish = resolve
        finishTimer = window.setTimeout(() => {
          finishTimer = null
          settleFinish(latest)
          closeSocket()
        }, timeoutMs)
        if (open) sendEndOfInput()
      })
      return finishPromise
    },
    close() {
      if (closed) return
      settleFinish(latest)
      closeSocket()
    },
  }
}
