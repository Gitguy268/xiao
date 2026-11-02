// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// The Send page. The connection, the pairing codes and the QR code are textarea's
// (lib/, MIT, unchanged), so Xiao and textarea can send to each other.
import { answerOffer, createOffer, opened, receiveNote, sendNote } from './lib/nearby.js';
import { qrSvg } from './lib/qr.js';

const $ = (id) => document.getElementById(id);
const ask = (name, data) => window.xiao.call(name, data);
const say = (text) => {
  $('status').textContent = text;
};
const pair = (code) => `https://gitguy268-textarea.vercel.app/#rtc=${code}`;

let notes = [];
let sender = null;
let receiver = null; // held here: nothing else keeps the connection alive

async function draw(where, code) {
  $(where).innerHTML = await qrSvg(pair(code)); // our own QR drawing of our own code
}

async function makeOffer() {
  say('Making a pairing code…');
  sender = await createOffer();
  $('offer-code').value = sender.code;
  await draw('offer-qr', sender.code);
  $('send-steps').hidden = false;
  say('');
}

async function connect() {
  const note = notes[Number($('note').value)];
  await sender.accept($('answer-code').value);
  say('Connecting…');
  await opened(sender.channel);
  say('Waiting for the other device to say yes…');
  const sent = await sendNote(sender.channel, { title: note.name.replace(/\.md$/, ''), text: note.text });
  say(sent ? 'Sent.' : 'The other device said no.');
}

async function answer() {
  receiver = await answerOffer($('incoming').value);
  $('answer-out').value = receiver.code;
  await draw('answer-qr', receiver.code);
  $('receive-steps').hidden = false;
  say('Waiting for the other device…');
  const channel = await receiver.channel;
  await opened(channel);
  const note = await receiveNote(channel, {
    confirm: ({ title, bytes }) => new Promise((resolve) => {
      $('offered-what').textContent = `"${title}" (${bytes.toLocaleString()} bytes).`;
      $('offered').hidden = false;
      $('accept').onclick = () => { $('offered').hidden = true; resolve(true); };
      $('decline').onclick = () => { $('offered').hidden = true; resolve(false); };
    }),
  });
  if (!note) return say('Declined.');
  await ask('notes.save', { name: null, text: note.text });
  say(`Saved "${note.title}" to your notes.`);
}

// Fills a box from the camera, with textarea's scanner.
async function scan(into) {
  const { startScan } = await import('./lib/qr-scan.js');
  $('camera').hidden = false;
  say('Point the camera at the code.');
  const stop = await startScan($('camera'), (found) => {
    $(into).value = found;
    say('');
    $('camera').hidden = true;
    stop?.();
  });
}

const guard = (fn) => () => fn().catch((e) => say(e.message));

async function init() {
  await ask('send.begin');
  notes = await ask('notes.list');
  $('note').replaceChildren(...notes.map((n, i) => {
    const o = document.createElement('option');
    o.value = i;
    o.textContent = n.name?.replace(/\.md$/, '') ?? 'New note';
    return o;
  }));
  $('make').disabled = !notes.length;
  if (!notes.length) say('You have no notes yet. Write one first.');
  $('make').addEventListener('click', guard(makeOffer));
  $('connect').addEventListener('click', guard(connect));
  $('answer').addEventListener('click', guard(answer));
  $('scan-answer').addEventListener('click', guard(() => scan('answer-code')));
  $('scan-offer').addEventListener('click', guard(() => scan('incoming')));
}

if (window.xiao) init().catch((e) => say(e.message));
