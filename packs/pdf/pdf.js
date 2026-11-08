// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Xiao's PDF tools page: pick a PDF (a file, a drop, one
// downloaded lately or one handed over from the viewer), pick a tool, get the
// new file back as a download.
import { pageCount, TOOLS } from './tools.mjs';

const $ = (id) => document.getElementById(id);
const call = window.xiao?.call ? (name, data) => window.xiao.call(name, data) : null;
const say = (text, error = false) => {
  $('status').textContent = text;
  $('status').classList.toggle('error', error);
};
const kb = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
let current = null; // { name, bytes, path? }

const tool = () => document.querySelector('[name="tool"]:checked').value;
const showOptions = () => {
  for (const div of $('options').querySelectorAll('[data-for]')) div.hidden = div.dataset.for !== tool();
};

async function use(name, bytes, path) {
  current = { name, bytes, path };
  $('file-name').textContent = name;
  $('file-actions').hidden = false;
  $('view').hidden = !call;
  say('');
  try {
    const n = await pageCount(bytes);
    $('file-info').textContent = `${n} ${n === 1 ? 'page' : 'pages'}, ${kb(bytes.length)}`;
  } catch (e) {
    $('file-info').textContent = /password/.test(e.message) ? 'Has a password: use "Remove a password" first' : kb(bytes.length);
  }
}

function clear() {
  current = null;
  $('file').value = '';
  $('file-name').textContent = 'Choose a PDF, or drop one here';
  $('file-info').textContent = '';
  $('file-actions').hidden = true;
  say('');
}

const isPdf = (f) => f && (f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
const pickFile = async (f) => isPdf(f) && use(f.name, new Uint8Array(await f.arrayBuffer()));

$('file').addEventListener('change', (e) => pickFile(e.target.files[0]));
$('drop').addEventListener('dragover', (e) => e.preventDefault());
$('drop').addEventListener('drop', (e) => {
  e.preventDefault();
  pickFile([...e.dataTransfer.files].find(isPdf));
});
$('clear').addEventListener('click', clear);
$('view').addEventListener('click', async () => {
  if (!current) return;
  try {
    await call('pdf.view', current.path ? { path: current.path } : { name: current.name, base64: current.bytes.toBase64() }); // the bridge carries JSON
  } catch (e) {
    say(e.message, true);
  }
});
for (const r of document.querySelectorAll('[name="tool"]')) r.addEventListener('change', showOptions);

$('options').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!current) return say('Choose a PDF first.', true);
  const box = $('options').querySelector(`[data-for="${tool()}"]`);
  const options = {};
  for (const input of box.querySelectorAll('[name]')) {
    if (input.type === 'file') options.files = await Promise.all([...input.files].map(async (f) => ({ name: f.name, type: f.type, bytes: new Uint8Array(await f.arrayBuffer()) })));
    else if (input.type === 'number' || input.name === 'per' || input.name === 'angle') options[input.name] = Number(input.value);
    else options[input.name] = input.value;
  }
  say('Working…');
  try {
    const out = await TOOLS[tool()](current.bytes, options);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([out], { type: 'application/pdf' }));
    a.download = current.name.replace(/(\.pdf)?$/i, ` (${tool()}).pdf`);
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
    say(`Done: ${a.download}`);
  } catch (err) {
    say(err.message, true);
  }
});

async function recent() {
  if (!call) return;
  const files = await call('pdf.recent').catch(() => []);
  $('recent-box').hidden = !files.length;
  $('recent').replaceChildren(...files.map((f) => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'link';
    b.textContent = f.name;
    b.addEventListener('click', async () => {
      try {
        const got = await call('pdf.read', { path: f.path });
        await use(got.name, new Uint8Array(got.bytes), f.path);
      } catch (err) {
        say(err.message, true);
      }
    });
    const meta = document.createElement('span');
    meta.textContent = `${kb(f.size)} · ${new Date(f.when).toLocaleDateString()}`;
    li.append(b, meta);
    return li;
  }));
}

showOptions();
recent();
// a PDF handed over by "More tools for this PDF"
call?.('pdf.handoff').then((h) => h && use(h.name, new Uint8Array(h.bytes))).catch(() => {});
