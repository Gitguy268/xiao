// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Assist, beside the page it is about. The question and the page's text go
// to Xiao (window.xiao.call), which finds the passages that answer it and,
// with the local AI on, writes an answer citing them. Clicking a passage
// shows it in the page. Everything shown here is text: nothing in an answer
// can act.
const $ = (id) => document.getElementById(id);
const ask = (name, data) => window.xiao.call(name, { tab, ...data });
const params = new URLSearchParams(location.search);
const tab = Number(params.get('tab'));
const summarize = params.get('summarize');

let polling = null;
let model = false; // the local AI is on: an answer follows the passages
function busy(on) {
  $('go').disabled = on;
  $('cancel').hidden = !on;
  clearInterval(polling);
  if (on) {
    polling = setInterval(async () => {
      const s = await ask('assist.status').catch(() => null);
      if (s?.progress) say(s.progress);
    }, 1000);
  }
}
const say = (text, error = false) => {
  $('status').textContent = text;
  $('status').classList.toggle('error', error);
};

function show({ evidence, answer }) {
  $('evidence').hidden = !evidence.length;
  $('passages').replaceChildren(...evidence.map((p) => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.n = p.n;
    const n = document.createElement('span');
    n.className = 'n';
    n.textContent = p.n;
    const t = document.createElement('span');
    t.textContent = p.text;
    b.append(n, t);
    b.addEventListener('click', () => ask('assist.show', { text: p.text }));
    li.append(b);
    return li;
  }));
  $('answer').hidden = !answer;
  if (!answer) return;
  // the answer as text, with each citation a button that shows its passage
  const text = $('answer-text');
  text.replaceChildren();
  let last = 0;
  for (const m of answer.text.matchAll(/\[(\d{1,3})\]/g)) {
    text.append(answer.text.slice(last, m.index));
    const passage = evidence.find((p) => p.n === Number(m[1]));
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cite';
    b.textContent = m[0];
    b.setAttribute('aria-label', `Show passage ${m[1]} in the page`);
    if (passage) b.addEventListener('click', () => ask('assist.show', { text: passage.text }));
    text.append(b);
    last = m.index + m[0].length;
  }
  text.append(answer.text.slice(last));
  $('answer-note').textContent = answer.said === 'unsupported' ? 'This answer cites none of the page\'s passages, so the page may not back it. Check the passages below.'
    : answer.said === 'not on page' ? 'The passages below are the closest the page comes.' : 'Written by the local AI from the passages below. Check them before relying on it.';
}

async function run(job) {
  busy(true);
  say('Reading…');
  try {
    const result = await job();
    show(result);
    say(result.answer ? '' : result.evidence.length ? '' : 'The page does not seem to talk about that.');
  } catch (e) {
    say(/AbortError|Cancelled/.test(e.message) ? 'Cancelled.' : e.message, true);
  } finally {
    busy(false);
  }
}

async function init() {
  let state;
  try {
    state = await ask('assist.state');
  } catch (e) {
    say(e.message, true);
    $('go').disabled = true;
    return;
  }
  model = !!state.model;
  $('about').textContent = summarize ? `Link: ${summarize}` : state.title;
  $('footer').textContent = state.model
    ? 'Answers are written by MiniCPM5 on this computer, from this page only. Nothing leaves your computer.'
    : 'The local AI is off, so Assist shows where the page talks about your question. Turn on Assist in the start page\'s Features for written answers, made on this computer.';
  if (summarize) {
    $('heading').textContent = 'What the link says';
    $('ask').hidden = true;
    run(() => ask('assist.summarize', { url: summarize }));
  } else {
    $('question').focus();
  }
}

$('ask').addEventListener('submit', (e) => {
  e.preventDefault();
  const question = $('question').value.trim();
  if (!question) return;
  run(async () => {
    // the passages show at once; the model's answer, which can take a while, comes after
    const found = await ask('assist.evidence', { question });
    show({ evidence: found.evidence, answer: null });
    if (!model || !found.evidence.length) return { ...found, answer: null };
    say('Writing an answer from these passages…');
    return ask('assist.ask', { question });
  });
});
$('cancel').addEventListener('click', () => ask('assist.cancel'));
if (window.xiao) init();
