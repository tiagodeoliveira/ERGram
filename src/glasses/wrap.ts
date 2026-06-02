// Wrap text into exact G2 display lines using pretext's pixel-accurate glyph
// widths (the same widths the firmware's LVGL renderer uses). We wrap ourselves
// — rather than letting the text container wrap — so we know the precise line
// array and can show a smooth, line-by-line scrolling window (chat feel), not
// firmware-quantized pages.
//
// Explicit '\n' is a hard break (an empty paragraph becomes one blank line).
// A single word wider than the line is hard-broken by character.

import { getTextWidth } from '@evenrealities/pretext'

export function wrapToLines(text: string, maxWidthPx: number): string[] {
  const lines: string[] = []

  for (const paragraph of text.split('\n')) {
    if (paragraph === '') {
      lines.push('')
      continue
    }

    let line = ''
    for (const word of paragraph.split(' ')) {
      const candidate = line ? `${line} ${word}` : word
      if (getTextWidth(candidate) <= maxWidthPx) {
        line = candidate
        continue
      }

      // Candidate overflows. Flush the current line (if any) first.
      if (line) lines.push(line)

      if (getTextWidth(word) <= maxWidthPx) {
        line = word
      } else {
        // Word alone is too wide — hard-break it by character.
        let chunk = ''
        for (const ch of word) {
          if (getTextWidth(chunk + ch) <= maxWidthPx) {
            chunk += ch
          } else {
            if (chunk) lines.push(chunk)
            chunk = ch
          }
        }
        line = chunk
      }
    }
    lines.push(line)
  }

  return lines.length ? lines : ['']
}
