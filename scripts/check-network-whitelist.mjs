#!/usr/bin/env node
// Pre-submission guard for the Even Hub network whitelist.
//
// The Even Hub portal scans the built bundle during review and flags any URL
// literal not covered by app.json's `permissions.network.whitelist`. That scan is
// a blunt substring sweep over the minified output — it can't tell that a GramJS
// transport template like `wss://${e}:${r}/apiws…` resolves at runtime to a DC
// host we already whitelist, nor that a vendored package's author URL is never
// fetched. This script reproduces that scan locally and classifies each hit, so a
// genuinely new un-whitelisted endpoint fails HERE (free, instant) instead of
// bouncing a portal review round-trip. Run automatically before `pnpm pack`.
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const DIST = 'dist/assets'
const APP_JSON = 'app.json'

// URL literals that are NOT runtime network targets and so can't (and shouldn't)
// live in the whitelist. Every entry must stay individually justified:
//
//  • GramJS connection-layer templates — `${…}` placeholders interpolated at
//    runtime to the Telegram DC hosts (wss://{pluto,venus,…}.web.telegram.org),
//    which ARE whitelisted as concrete origins. You can't whitelist a template.
//  • Vendored dependency doc / author / source URLs (buffer→feross, murmurhash,
//    crypto-browserify, GramJS→telethon docs) — string constants in third-party
//    code, never passed to fetch/WebSocket.
//
// If the portal ever flags one of these, the answer is "known string literal, no
// action needed" — this list is the audit trail for that answer.
const KNOWN_SAFE = [
  // GramJS transport templates → resolve to whitelisted *.web.telegram.org DCs.
  'http://[${this.correctForm()}]${e}/',
  'ws://${e}:${r}/apiws${n?',
  'wss://${e}:${r}/apiws${n?',
  // Vendored dependency doc/source/author strings — not network calls.
  'http://feross.org>',
  'https://feross.org>',
  'https://feross.org/opensource>',
  'http://github.com/garycourt/murmurhash-js',
  'http://github.com/homebrewing/brauhaus-diff',
  'https://github.com/browserify/crypto-browserify',
  'http://sites.google.com/site/murmurhash/',
  'https://docs.telethon.dev/en/stable/concepts/entities.html',
]

if (!existsSync(DIST)) {
  console.error(`✗ ${DIST} not found — run \`pnpm build\` before the whitelist check.`)
  process.exit(1)
}

const app = JSON.parse(readFileSync(APP_JSON, 'utf8'))
const net = (app.permissions ?? []).find((p) => p.name === 'network')
const whitelist = net?.whitelist ?? []

// Collect URL literals from every built JS chunk.
const urls = new Set()
for (const f of readdirSync(DIST)) {
  if (!f.endsWith('.js')) continue
  const src = readFileSync(join(DIST, f), 'utf8')
  for (const m of src.matchAll(/(?:https?|wss?):\/\/[^"'`\\ \n]*/g)) urls.add(m[0])
}

const isBareScheme = (u) => /^(?:https?|wss?):\/\/$/.test(u)
const isCovered = (u) => whitelist.some((w) => u === w || u.startsWith(w))
const isKnownSafe = (u) => KNOWN_SAFE.includes(u)

const unlisted = [...urls].filter((u) => !isBareScheme(u) && !isCovered(u) && !isKnownSafe(u))

if (unlisted.length) {
  console.error('✗ Bundle references URL(s) not covered by app.json network.whitelist:')
  for (const u of unlisted.sort()) console.error('   ' + u)
  console.error(
    '\nResolve each before submitting:\n' +
      '  • a real endpoint your app calls → add it to app.json network.whitelist\n' +
      '  • a vendored doc/comment string or runtime template → add it to KNOWN_SAFE\n' +
      `    in ${import.meta.url.replace('file://', '')}, with a justification.`,
  )
  process.exit(1)
}

console.log(
  `✓ network whitelist OK — ${urls.size} URL literal(s) scanned; ` +
    'all whitelisted, dynamic, or known-safe.',
)
