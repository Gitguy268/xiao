import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nextEvents, parseIcs, whenLabel } from '../core/lib/ics.mjs';

const local = (...a) => new Date(...a).getTime();
const ICS = [
  'BEGIN:VCALENDAR',
  'BEGIN:VEVENT', 'SUMMARY:Standup', 'DTSTART:20261109T090000', 'DTEND:20261109T091500',
  'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=6', 'EXDATE:20261111T090000',
  'DESCRIPTION:Join: https://meet.google.com/abc-defg-hij\\nThanks', 'END:VEVENT',
  'BEGIN:VEVENT', 'SUMMARY:Lunch with a very long', ' title folded', 'DTSTART:20261108T113000Z', 'DTEND:20261108T123000Z', 'LOCATION:Café', 'END:VEVENT',
  'BEGIN:VEVENT', 'SUMMARY:Holiday', 'DTSTART;VALUE=DATE:20261110', 'END:VEVENT',
  'BEGIN:VEVENT', 'SUMMARY:Gone', 'DTSTART:20261109T100000', 'STATUS:CANCELLED', 'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

test('events, folded lines, links and cancellations', () => {
  const events = parseIcs(ICS);
  assert.equal(events.length, 3);
  assert.equal(events[1].title, 'Lunch with a very longtitle folded');
  assert.equal(events[0].join, 'https://meet.google.com/abc-defg-hij');
  assert.equal(events[1].start, Date.UTC(2026, 10, 8, 11, 30));
  assert.equal(events[2].allDay, true);
});

test('the next events come from repeats too, skipping excluded days and all-day events', () => {
  const next = nextEvents(parseIcs(ICS), local(2026, 10, 9, 8, 0), 4);
  assert.deepEqual(next.map((e) => [e.title, new Date(e.start).getDate()]), [['Standup', 9], ['Standup', 13], ['Standup', 16], ['Standup', 18]]);
  assert.equal(next[0].end - next[0].start, 15 * 60_000);
});

test('when an event is, in words', () => {
  const now = local(2026, 10, 9, 8, 50);
  assert.equal(whenLabel(local(2026, 10, 9, 9, 0), local(2026, 10, 9, 9, 15), now), 'in 10 min');
  assert.equal(whenLabel(local(2026, 10, 9, 8, 45), local(2026, 10, 9, 9, 15), now), 'now');
  assert.equal(whenLabel(local(2026, 10, 9, 14, 30), local(2026, 10, 9, 15, 0), now), 'at 14:30');
  assert.equal(whenLabel(local(2026, 10, 10, 9, 0), local(2026, 10, 10, 9, 30), now), 'tomorrow at 09:00');
});
