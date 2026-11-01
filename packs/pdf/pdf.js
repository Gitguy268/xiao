// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// The PDF tools page: pick a file and a tool, get the new file back as a download.
import { TOOLS } from './tools.mjs';

const $ = (id) => document.getElementById(id);
const say = (text, error = false) => {
  $('status').textContent = text;
  $('status').classList.toggle('error', error);
};
let file = null;

const tool = () => document.querySelector('[name="tool"]:checked').value;
const showOptions = () => {
  for (const div of $('options').querySelectorAll('[data-for]')) div.hidden = div.dataset.for !== tool();
};

function pick(f) {
  if (!f) return;
  file = f;
  $('file-name').textContent = f.name;
  say('');
}

$('file').addEventListener('change', (e) => pick(e.target.files[0]));
$('drop').addEventListener('dragover', (e) => e.preventDefault());
$('drop').addEventListener('drop', (e) => {
  e.preventDefault();
  pick([...e.dataTransfer.files].find((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name)));
});
for (const r of document.querySelectorAll('[name="tool"]')) r.addEventListener('change', showOptions);

$('options').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!file) return say('Choose a PDF first.', true);
  const box = $('options').querySelector(`[data-for="${tool()}"]`);
  const options = {};
  for (const input of box.querySelectorAll('[name]')) {
    if (input.type === 'file') options.files = await Promise.all([...input.files].map(async (f) => ({ name: f.name, type: f.type, bytes: new Uint8Array(await f.arrayBuffer()) })));
    else if (input.type === 'number' || input.name === 'per') options[input.name] = Number(input.value);
    else options[input.name] = input.value;
  }
  say('Working…');
  try {
    const out = await TOOLS[tool()](new Uint8Array(await file.arrayBuffer()), options);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([out], { type: 'application/pdf' }));
    a.download = file.name.replace(/(\.pdf)?$/i, ` (${tool()}).pdf`);
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
    say(`Done: ${a.download}`);
  } catch (err) {
    say(err.message, true);
  }
});

showOptions();
