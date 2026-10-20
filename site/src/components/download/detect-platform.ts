// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Same job as zen-browser/www's detect-platform.ts, without a UA parser library.
export type OS = 'mac' | 'windows' | 'linux'

export function detectOS(userAgent: string, platform = ''): OS {
  const s = `${platform} ${userAgent}`
  if (/Windows|Win32|Win64/i.test(s)) return 'windows'
  if (/Linux|X11|CrOS|Ubuntu|Fedora/i.test(s) && !/Android/i.test(s)) return 'linux'
  return 'mac'
}
