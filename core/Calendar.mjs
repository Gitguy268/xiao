// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Calendar preview (Arc's live calendar preview, A21, adapted): the next
// meetings from a calendar address (a secret .ics or webcal link, as Google,
// Outlook, Fastmail and iCloud give out) or a .ics file on this computer,
// with a countdown and a Join button for Meet, Zoom, Teams and similar links.
// Off until an address is set. The address is fetched without cookies every
// 15 minutes and on a reader's request; silent mode stops the background
// fetch. No account is signed in to; nothing is sent but that request.
import { nextEvents, parseIcs, whenLabel } from './lib/ics.mjs';

const TIMEOUT = 30_000;
const MAX = 5_000_000;

const EVERY = 15 * 60_000;

export function checkSource(source) {
  const s = String(source ?? '').trim();
  if (!s) return '';
  if (/^webcals?:\/\//i.test(s)) return s.replace(/^webcals?:/i, 'https:');
  if (/^https:\/\/\S+$/i.test(s)) return s;
  if (/^\/.*\.ics$/i.test(s) || /^[A-Za-z]:\\.*\.ics$/i.test(s)) return s; // a file on this computer
  throw new Error('Use a calendar address that starts with https:// or webcal://, or an .ics file.');
}

export class Calendar {
  events = [];
  error = '';
  fetchedAt = 0;

  constructor(xiao) {
    this.xiao = xiao;
  }

  get source() {
    return this.xiao.features.calendar || '';
  }

  // asked: the reader just set the address, so one fetch is theirs even in silent mode
  start({ asked = false } = {}) {
    clearInterval(this.timer);
    this.events = [];
    this.error = '';
    if (!this.source) return;
    if (asked || !this.xiao.silent.on) this.refresh().catch(() => {});
    this.timer = setInterval(() => {
      if (!this.xiao.silent.on) this.refresh().catch(() => {});
    }, EVERY);
  }

  async refresh() {
    const source = this.source;
    if (!source) return;
    try {
      let text;
      if (/^https:/i.test(source)) {
        const host = new URL(source).host;
        // AbortSignal.timeout() throws in system modules, so a controller and a timer
        const stop = new AbortController();
        const timer = setTimeout(() => stop.abort(), TIMEOUT);
        try {
          const r = await this.xiao.silent.asking([host], () => fetch(source, { credentials: 'omit', cache: 'no-store', signal: stop.signal }));
          if (!r.ok) throw new Error(`The calendar answered ${r.status}.`);
          if (Number(r.headers.get('content-length') ?? 0) > MAX) throw new Error('The calendar is larger than 5 MB.');
          text = (await r.text()).slice(0, MAX);
        } catch (e) {
          throw stop.signal.aborted ? new Error('The calendar did not answer within 30 seconds.') : e;
        } finally {
          clearTimeout(timer);
        }
      } else {
        text = await IOUtils.readUTF8(source, { maxBytes: MAX });
      }
      if (this.source !== source) return; // the address changed meanwhile
      this.events = parseIcs(text);
      this.error = '';
      this.fetchedAt = Date.now();
    } catch (e) {
      if (this.source === source) this.error = e.message;
    }
  }

  // The next three, as the panel and start page show them.
  next(now = Date.now()) {
    return { on: !!this.source, error: this.error, events: nextEvents(this.events, now, 3).map((e) => ({ ...e, when: whenLabel(e.start, e.end, now) })) };
  }
}
