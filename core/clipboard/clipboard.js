// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

const $ = (id) => document.getElementById(id);
const ask = (name, data) => window.xiao.call(name, data);

function render(clips) {
  $('clear').hidden = !clips.length;
  $('status').textContent = clips.length ? '' : 'Nothing copied yet.';
  $('clips').replaceChildren(...clips.map((clip) => {
    const li = document.createElement('li');
    const text = document.createElement('pre');
    text.textContent = clip.text;
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.textContent = 'Copy';
    copy.addEventListener('click', async () => {
      await ask('clip.copy', { at: clip.at });
      $('status').textContent = 'Copied.';
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Remove';
    remove.addEventListener('click', async () => render(await ask('clip.remove', { at: clip.at })));
    li.append(text, copy, remove);
    return li;
  }));
}

$('clear').addEventListener('click', async () => render(await ask('clip.clear')));
$('pasted').addEventListener('paste', (e) => {
  e.preventDefault();
  const rows = [...e.clipboardData.types].flatMap((type) => {
    const dt = document.createElement('dt');
    dt.textContent = type;
    const dd = document.createElement('dd');
    dd.textContent = type === 'Files' ? [...e.clipboardData.files].map((f) => `${f.name} (${f.type}, ${f.size} bytes)`).join('\n') : e.clipboardData.getData(type).slice(0, 2000);
    return [dt, dd];
  });
  $('kinds').replaceChildren(...rows);
});
if (window.xiao) ask('clip.list').then(render, (e) => { $('status').textContent = e.message; });
