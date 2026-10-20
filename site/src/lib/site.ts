// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import en from '../i18n/en/translation.json'

export const REPO = 'https://github.com/Gitguy268/xiao'
export const RELEASES = `${REPO}/releases`

// Links inside the site, under the GitHub Pages base path.
export const url = (path = '') => `${import.meta.env.BASE_URL.replace(/\/$/, '')}/${path.replace(/^\//, '')}`

// i18n scaffold kept from zen-browser/www; English is the only language so far.
const UI = { en }
export const getUI = (locale?: string) => UI[(locale ?? 'en') as keyof typeof UI] ?? en
export const localePaths = () => [{ params: { locale: undefined } }]
