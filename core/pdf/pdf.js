// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Xiao's PDF page before the PDF tools are downloaded (or while they are switched
// off): offers the download, then reloads into the tools once they are served.
(() => {
const $ = (id) => document.getElementById(id);
const call = (name, data) => window.xiao.call(name, data);
const say = (text) => { $('status').textContent = text; };

async function refresh() {
  const s = await call('pdf.state');
  if (s.pack) return void location.replace(s.url); // the tools are served now
  $('size').textContent = s.size || $('size').textContent;
  $('get').disabled = s.busy;
  $('get').textContent = s.installed && !s.on ? 'Switch the PDF tools on' : 'Get the PDF tools';
  say(s.error ? `The download failed: ${s.error}` : s.busy ? 'Downloading…' : '');
  if (s.busy) setTimeout(refresh, 1000);
}

$('get').addEventListener('click', async () => {
  $('get').disabled = true;
  say('Downloading…');
  try {
    await call('pdf.get');
  } catch (e) {
    say(e.message);
  }
  setTimeout(refresh, 500);
});

async function view(f) {
  if (!f || !(f.type === 'application/pdf' || /\.pdf$/i.test(f.name))) return;
  await call('pdf.view', { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }).catch((e) => say(e.message));
}
$('file').addEventListener('change', (e) => view(e.target.files[0]));
document.querySelector('.drop').addEventListener('dragover', (e) => e.preventDefault());
document.querySelector('.drop').addEventListener('drop', (e) => {
  e.preventDefault();
  view(e.dataTransfer.files[0]);
});

refresh().catch((e) => say(e.message));
})();
