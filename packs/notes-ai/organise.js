// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// The voice box: record, transcribe (Whisper small), then sort what was said
// and the sticky notes into a board (MiniCPM5 2B). Both models run in this
// tab. lib/ and vendor/ are textarea's files, unchanged (MIT); the notes are
// Xiao's sticky notes, reached through window.xiao.call like the start page.
import { createBoard } from './lib/board-panel.js';
import { boardNote, buildOrganisePrompt } from './lib/organise.js';

const $ = (id) => document.getElementById(id);

// Whisper's languages (textarea's lib/speech-panel.js has the same list). It
// has to be told which: left alone it hears English, and Xiao reports English
// to pages whatever the system's language is.
const LANGUAGES = ('af am ar as az ba be bg bn bo br bs ca cs cy da de el en es et eu fa fi fo fr gl gu haw ha ' +
  'he hi hr ht hu hy id is it ja jw ka kk km kn ko la lb ln lo lt lv mg mi mk ml mn mr ms mt ' +
  'my ne nl nn no oc pa pl ps pt ro ru sa sd si sk sl sn so sq sr su sv sw ta te tg th tk tl ' +
  'tr tt uk ur uz vi yi yo zh').split(' ');
const names = new Intl.DisplayNames([navigator.language], { type: 'language' });
const remembered = (() => {
  try {
    return localStorage.getItem('xiao:speech-language');
  } catch {
    return null;
  }
})();
$('lang').append(...LANGUAGES.map((code) => new Option(names.of(code) ?? code, code))
  .sort((a, b) => a.text.localeCompare(b.text)));
$('lang').value = LANGUAGES.includes(remembered) ? remembered : LANGUAGES.includes(navigator.language.split('-')[0]) ? navigator.language.split('-')[0] : 'en';
$('lang').addEventListener('change', () => {
  try {
    localStorage.setItem('xiao:speech-language', $('lang').value);
  } catch {} // not remembered, still used
});
const ask = (name, data) => window.xiao.call(name, data);
const BOARD = /^# Organised /;
const say = (text, { error = false } = {}) => {
  $('status').textContent = text;
  $('status').classList.toggle('error', error);
};

let recorder = null;
let busy = null; // the AbortController of the run in progress
let shown = null; // { name, text } of the board on screen

const board = createBoard({
  onChange: async (text) => {
    shown = { ...shown, text };
    board.update(text);
    await ask('notes.save', shown);
  },
});
$('board').append(board.element);

async function showLatest() {
  const latest = (await ask('notes.list')).find((n) => BOARD.test(n.text));
  if (!latest) return;
  shown = latest;
  if (board.update(latest.text)) board.open();
}

async function transcribe(blob) {
  const whisper = await import('./lib/whisper.js');
  say('Reading the recording…');
  const samples = await whisper.decodeAudio(blob);
  const engine = await whisper.loadEngine({ model: 'small', onProgress: say, signal: busy.signal });
  say('Writing down what you said…');
  const text = (await engine.transcribe(samples, { language: $('lang').value, signal: busy.signal })).trim();
  $('said').value = [$('said').value.trim(), text].filter(Boolean).join('\n');
  say(text ? '' : 'No speech was heard.');
}

async function organise() {
  const spoken = $('said').value.trim();
  const notes = await ask('notes.list');
  const own = notes.filter((n) => !BOARD.test(n.text));
  const picked = $('all').checked ? [...own, ...notes.filter((n) => BOARD.test(n.text)).slice(0, 1)] : [];
  if (!spoken && !picked.length) {
    say('Say or type something first.', { error: true });
    return;
  }
  const { loadEngine } = await import('./lib/gemma.js');
  const engine = await loadEngine({ model: 'minicpm5', onProgress: say, signal: busy.signal });
  say('Sorting… a minute or two on this computer.');
  const { messages, truncated } = buildOrganisePrompt(spoken, picked.map(({ name, text }) => ({ title: name.replace(/\.md$/, ''), text })));
  const text = boardNote(await engine.run(messages));
  shown = { name: null, text };
  shown.name = (await ask('notes.save', shown)).name;
  board.update(text);
  board.open();
  $('said').value = '';
  say(truncated ? 'Done. Only the newest notes fitted, so older ones were left out.' : 'Done. The board is saved as a sticky note.');
}

// One thing at a time, with Cancel, and every failure said in the status line.
async function run(job) {
  busy = new AbortController();
  $('cancel').hidden = false;
  $('organise').disabled = true;
  try {
    await job();
  } catch (e) {
    say(e?.name === 'AbortError' ? 'Cancelled.' : (e?.message || String(e)), { error: e?.name !== 'AbortError' });
  } finally {
    busy = null;
    $('cancel').hidden = true;
    $('organise').disabled = false;
  }
}

async function toggleRecording() {
  if (recorder) {
    recorder.stop();
    return;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    say(e?.name === 'NotAllowedError' ? 'The microphone was refused. Allow it, or type instead.' : e?.message || String(e), { error: true });
    return;
  }
  const pieces = [];
  recorder = new MediaRecorder(stream);
  recorder.addEventListener('dataavailable', (e) => pieces.push(e.data));
  recorder.addEventListener('stop', () => {
    for (const t of stream.getTracks()) t.stop();
    const type = recorder.mimeType;
    recorder = null;
    $('record').setAttribute('aria-pressed', 'false');
    $('record-label').textContent = 'Record';
    run(() => transcribe(new Blob(pieces, { type })));
  });
  recorder.start();
  $('record').setAttribute('aria-pressed', 'true');
  $('record-label').textContent = 'Stop';
  say('Listening… press Stop when you are done.');
}

$('record').addEventListener('click', () => {
  if (!busy || recorder) toggleRecording();
});
$('organise').addEventListener('click', () => run(organise));
$('cancel').addEventListener('click', () => busy?.abort());
if (window.xiao) showLatest().catch((e) => say(`Xiao is not answering: ${e.message}`, { error: true }));
