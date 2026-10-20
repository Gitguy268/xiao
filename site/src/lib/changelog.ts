// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Reads CHANGELOG.md for the release notes page and its feed. The changelog
// only uses "## version (date)" headings, "- " lists one level deep, and
// inline **bold**, `code` and [links](url), so that is all this understands.
import text from '../../../CHANGELOG.md?raw'

export interface Release { version: string; date: string; html: string }

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function inline(s: string) {
  return escape(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>')
}

function list(lines: string[]) {
  const items: { text: string; subs: string[] }[] = []
  for (const line of lines) {
    const sub = line.match(/^ {2,}- (.*)$/)
    const top = line.match(/^- (.*)$/)
    if (top) items.push({ text: top[1], subs: [] })
    else if (sub && items.length) items.at(-1)!.subs.push(sub[1])
  }
  const li = ({ text, subs }: (typeof items)[number]) =>
    `<li>${inline(text)}${subs.length ? `<ul>${subs.map((x) => `<li>${inline(x)}</li>`).join('')}</ul>` : ''}</li>`
  return `<ul>${items.map(li).join('')}</ul>`
}

export function releases(): Release[] {
  return text.split(/^## /m).slice(1).map((block) => {
    const [head, ...rest] = block.split('\n')
    const m = head.match(/^(\S+)\s*\((.+)\)/)
    return { version: m?.[1] ?? head.trim(), date: m?.[2] ?? '', html: list(rest) }
  })
}
