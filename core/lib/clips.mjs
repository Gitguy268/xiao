// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

export const MOST = 50;
const LONGEST = 20_000;

// The list with this text added at the top. Copying something again moves it
// up rather than listing it twice; blank and overlong text is left out.
export function addClip(clips, text, at) {
  if (typeof text !== 'string' || !text.trim() || text.length > LONGEST) return clips;
  return [{ text, at }, ...clips.filter((c) => c.text !== text)].slice(0, MOST);
}
