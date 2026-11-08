// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// A calendar file (iCalendar, .ics) → its events, and the next ones from a
// moment on, with a meeting link when the event has one. Covers what calendar
// exports hold in practice: folded lines, UTC, floating and TZID times (TZID
// read as this computer's time zone), all-day dates, and daily or weekly
// repeats with COUNT, UNTIL, INTERVAL and BYDAY. Pure, node-tested.
const unfold = (text) => String(text).replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
const unescape = (v) => v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

export function parseDate(value, params = '') {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (h === undefined || /VALUE=DATE(?!-)/.test(params)) return { at: new Date(+y, +mo - 1, +d).getTime(), allDay: true };
  const parts = [+y, +mo - 1, +d, +h, +mi, +(s ?? 0)];
  return { at: z ? Date.UTC(...parts) : new Date(...parts).getTime(), allDay: false };
}

const HOSTS = ['meet.google.com', 'zoom.us', 'teams.microsoft.com', 'teams.live.com', 'whereby.com', 'meet.jit.si', 'webex.com'];
// The first https link in the text whose host is a meeting service (or its subdomain), never a link that only mentions one.
export function meetingLink(text) {
  for (const m of String(text ?? '').matchAll(/https:\/\/[^\s<>"']+/gi)) {
    try {
      const u = new URL(m[0].replace(/[).,;]+$/, ''));
      if (!u.username && !u.password && HOSTS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`))) return u.href;
    } catch {}
  }
  return null;
}

export function parseIcs(text) {
  const events = [];
  let ev = null;
  for (const line of unfold(text).split('\n')) {
    if (line === 'BEGIN:VEVENT') ev = {};
    else if (line === 'END:VEVENT') {
      if (ev?.start) events.push(ev);
      ev = null;
    } else if (ev) {
      const i = line.indexOf(':');
      if (i < 0) continue;
      const [name, ...params] = line.slice(0, i).split(';');
      const value = line.slice(i + 1);
      const p = params.join(';');
      if (name === 'DTSTART') ev.start = parseDate(value, p);
      else if (name === 'DTEND') ev.end = parseDate(value, p);
      else if (name === 'SUMMARY') ev.title = unescape(value).slice(0, 200);
      else if (name === 'LOCATION') ev.location = unescape(value).slice(0, 300);
      else if (name === 'URL') ev.url = value.trim();
      else if (name === 'DESCRIPTION') ev.description = unescape(value).slice(0, 4000);
      else if (name === 'RRULE') ev.rrule = Object.fromEntries(value.split(';').map((kv) => kv.split('=')));
      else if (name === 'STATUS') ev.cancelled = /CANCELLED/i.test(value);
      else if (name === 'EXDATE') ev.exdates = [...(ev.exdates ?? []), ...value.split(',').map((v) => parseDate(v, p)?.at)];
    }
  }
  return events.filter((e) => !e.cancelled).map((e) => {
    const join = [e.url, e.location, e.description].map(meetingLink).find(Boolean) ?? null;
    return {
      title: e.title || 'Untitled event',
      start: e.start.at,
      end: e.end?.at ?? e.start.at + (e.start.allDay ? 86_400_000 : 3_600_000),
      allDay: e.start.allDay,
      join,
      rrule: e.rrule ?? null,
      exdates: (e.exdates ?? []).filter(Boolean),
    };
  });
}

// The times an event happens from `from` on (at most `limit`), repeats included.
function occurrences(e, from, limit = 3) {
  const length = e.end - e.start;
  if (!e.rrule) return e.end > from ? [{ ...e }] : [];
  const freq = e.rrule.FREQ;
  if (freq !== 'DAILY' && freq !== 'WEEKLY') return e.end > from ? [{ ...e }] : [];
  const interval = Math.max(1, Number(e.rrule.INTERVAL ?? 1));
  const until = e.rrule.UNTIL ? parseDate(e.rrule.UNTIL)?.at ?? Infinity : Infinity;
  const count = e.rrule.COUNT ? Number(e.rrule.COUNT) : Infinity;
  const byDay = freq === 'WEEKLY' && e.rrule.BYDAY ? e.rrule.BYDAY.split(',').map((d) => DAYS.indexOf(d.slice(-2))).filter((d) => d >= 0) : null;
  const out = [];
  const first = new Date(e.start);
  let n = 0;
  for (let day = 0; day < 3700 && n < count && out.length < limit; day++) {
    const t = new Date(first);
    t.setDate(first.getDate() + day); // local days, so a repeat keeps its clock time across DST
    const at = t.getTime();
    if (at > until) break;
    const weeks = Math.floor(day / 7);
    const hit = freq === 'DAILY' ? day % interval === 0
      : weeks % interval === 0 && (byDay ? byDay.includes(t.getDay()) : t.getDay() === first.getDay());
    if (!hit) continue;
    n++;
    if (e.exdates.includes(at)) continue;
    if (at + length > from) out.push({ ...e, start: at, end: at + length });
  }
  return out;
}

export function nextEvents(events, from, limit = 3) {
  return events.flatMap((e) => occurrences(e, from, limit))
    .filter((e) => !e.allDay)
    .sort((a, b) => a.start - b.start)
    .slice(0, limit)
    .map(({ title, start, end, join }) => ({ title, start, end, join }));
}

// "in 12 min", "now", "at 14:30", "tomorrow at 09:00"
export function whenLabel(start, end, now) {
  if (now >= start && now < end) return 'now';
  const mins = Math.round((start - now) / 60_000);
  if (mins < 60) return `in ${Math.max(1, mins)} min`;
  const d = new Date(start);
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const today = new Date(now);
  const tomorrow = new Date(now);
  tomorrow.setDate(today.getDate() + 1);
  if (d.toDateString() === today.toDateString()) return `at ${time}`;
  if (d.toDateString() === tomorrow.toDateString()) return `tomorrow at ${time}`;
  return `${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} at ${time}`;
}
