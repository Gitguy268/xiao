// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// RSS 2.0 feed of the release notes (zen-browser/www has one too), written by hand: no extra dependency.
import type { APIRoute } from 'astro'
import { releases } from '../lib/changelog'
import { url } from '../lib/site'

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export const GET: APIRoute = ({ site }) => {
  const page = new URL(url('release-notes/'), site).href
  const items = releases().map((r) => {
    const date = Date.parse(r.date)
    return `    <item>
      <title>Xiao ${xml(r.version)}</title>
      <link>${page}#v${xml(r.version)}</link>
      <guid isPermaLink="false">xiao-${xml(r.version)}</guid>${Number.isNaN(date) ? '' : `\n      <pubDate>${new Date(date).toUTCString()}</pubDate>`}
      <description>${xml(r.html)}</description>
    </item>`
  })
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Xiao release notes</title>
    <link>${page}</link>
    <description>What changed in each Xiao release.</description>
    <language>en</language>
${items.join('\n')}
  </channel>
</rss>
`
  return new Response(body, { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' } })
}
