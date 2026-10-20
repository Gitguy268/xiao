// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Reads shared/prefs/*.yaml (the files the browser itself uses) for the
// privacy page, keeping the "# --- Section ---" headings and their notes.
import { parse } from 'yaml'
import balanced from '../../../shared/prefs/balanced.yaml?raw'
import strict from '../../../shared/prefs/strict.yaml?raw'

const FILES = { balanced, strict }
type File = keyof typeof FILES

export interface Pref { name: string; value: string | number | boolean }
export interface Section { title: string; about: string; prefs: Pref[] }

export function readSections(file: File): Section[] {
  const text = FILES[file]
  const values = new Map((parse(text) as Pref[]).map((p) => [p.name, p.value]))
  const sections: Section[] = []
  let current: Section | undefined
  for (const line of text.split('\n')) {
    const heading = line.match(/^# --- (.+) ---$/)
    if (heading) {
      current = { title: heading[1], about: '', prefs: [] }
      sections.push(current)
    } else if (current && !current.prefs.length && line.startsWith('# ')) {
      current.about += `${line.slice(2)} `
    } else {
      const name = line.match(/^- name: (.+)$/)?.[1]
      if (name && current) current.prefs.push({ name, value: values.get(name)! })
    }
  }
  return sections
}

export function readList(file: File): Pref[] {
  return parse(FILES[file])
}
