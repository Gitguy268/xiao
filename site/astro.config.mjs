// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Based on zen-browser/www's config (MPL-2.0): same i18n routing, served
// from GitHub Pages under /xiao.
import sitemap from '@astrojs/sitemap'
import { defineConfig } from 'astro/config'

export default defineConfig({
  site: 'https://gitguy268.github.io',
  base: '/xiao',
  trailingSlash: 'always',
  integrations: [sitemap()],
  // The privacy page reads ../shared/prefs, outside the site folder.
  vite: { server: { fs: { allow: ['..'] } } },
  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
    routing: { fallbackType: 'rewrite', prefixDefaultLocale: false },
  },
})
