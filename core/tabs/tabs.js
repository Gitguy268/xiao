// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

const $ = (id) => document.getElementById(id);
const ask = (name, data) => window.xiao.call(name, data);
let all = { tabs: [], spaces: [] };
let shown = [];
let plan = null;
const ticked = new Set();

const site = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};
const ago = (t) => {
  const m = Math.round((Date.now() - t) / 60_000);
  return m < 60 ? `${m} min` : m < 2880 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} days`;
};
const say = (t) => { $('status').textContent = t; };

function render() {
  const q = $('command').value.trim().toLowerCase();
  shown = all.tabs.filter((t) => !q || plan || `${t.title} ${t.url}`.toLowerCase().includes(q));
  if (plan) shown = all.tabs.filter((t) => plan.ids.includes(t.id));
  $('tabs').replaceChildren(...shown.map((t) => {
    const li = document.createElement('li');
    li.classList.toggle('in-plan', !!plan);
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = ticked.has(t.id);
    box.disabled = t.pinned || t.essential;
    box.setAttribute('aria-label', t.title);
    box.addEventListener('change', () => {
      if (box.checked) ticked.add(t.id); else ticked.delete(t.id);
      count();
    });
    const title = document.createElement('button');
    title.type = 'button';
    title.className = 'title';
    title.textContent = t.title || t.url;
    const host = document.createElement('span');
    host.className = 'site';
    host.textContent = `${site(t.url)}${t.space ? ` · ${t.space}` : ''}${t.pinned || t.essential ? ' · pinned' : ''}${t.muted ? ' · muted' : ''}`;
    title.append(host);
    title.addEventListener('click', () => ask('tabs.focus', { id: t.id }));
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = t.selected ? 'on screen' : ago(t.lastAccessed);
    li.append(box, title, meta);
    return li;
  }));
  count();
}

function count() {
  for (const id of [...ticked]) if (!all.tabs.some((t) => t.id === id)) ticked.delete(id);
  $('count').textContent = `${ticked.size} ticked, ${shown.length} shown of ${all.tabs.length}`;
  $('all').checked = shown.length > 0 && shown.filter((t) => !t.pinned && !t.essential).every((t) => ticked.has(t.id));
}

async function load() {
  all = await ask('tabs.list');
  $('move-to').replaceChildren(new Option('Move to space…', ''), ...all.spaces.map((s) => new Option(s.name, s.uuid)));
  render();
}

async function run(action, extra = {}) {
  let ids = [...ticked];
  // Group with nothing ticked groups every tab shown by site
  if (!ids.length && action === 'group') {
    ids = shown.filter((t) => !t.pinned && !t.essential).map((t) => t.id);
    extra = { ...extra, bySite: true };
  }
  if (!ids.length) return say('Tick some tabs first.');
  let r;
  try {
    r = await ask('tabs.run', { action, ids, ...extra });
  } catch (e) {
    return say(e.message);
  }
  ticked.clear();
  say(`${r.done} ${r.done === 1 ? 'tab' : action === 'group' ? 'groups' : 'tabs'} ${{ close: 'closed', archive: 'archived (find them in the Library)', group: 'made', mute: 'muted', unmute: 'unmuted', move: 'moved' }[action]}.`);
  await load();
}

$('command-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = $('command').value.trim();
  if (!text) return;
  const p = await ask('tabs.plan', { text });
  if (p.error) {
    plan = null;
    render();
    return say(p.error);
  }
  plan = p;
  const verb = { close: 'Close', archive: 'Archive', move: `Move to ${p.spaceName}:`, mute: 'Mute', unmute: 'Unmute', group: p.bySite ? 'Group by site' : 'Group' }[p.action];
  $('plan-text').textContent = p.ids.length ? `${verb} ${p.ids.length} ${p.ids.length === 1 ? 'tab' : 'tabs'} (listed below)?` : 'No tabs match that.';
  $('plan-go').hidden = !p.ids.length;
  $('plan').hidden = false;
  say('');
  render();
});
$('command').addEventListener('input', () => {
  if (plan) cancel();
  render();
});
function cancel() {
  plan = null;
  $('plan').hidden = true;
  render();
}
$('plan-cancel').addEventListener('click', cancel);
$('plan-go').addEventListener('click', async () => {
  const p = plan;
  cancel();
  ticked.clear();
  let r;
  try {
    r = await ask('tabs.run', { action: p.action, ids: p.ids, space: p.space, bySite: p.bySite });
  } catch (e) {
    await load();
    return say(e.message);
  }
  say(`Done: ${r.done}.${p.action === 'group' ? ' "Undo tab groups" in the address bar puts them back.' : p.action === 'archive' ? ' Find them in the Library\'s Archive.' : ''}`);
  $('command').value = '';
  await load();
});
$('all').addEventListener('change', () => {
  for (const t of shown) if (!t.pinned && !t.essential) { if ($('all').checked) ticked.add(t.id); else ticked.delete(t.id); }
  render();
});
for (const b of document.querySelectorAll('[data-act]')) b.addEventListener('click', () => run(b.dataset.act));
$('move-to').addEventListener('change', async () => {
  const space = $('move-to').value;
  $('move-to').value = '';
  if (space) await run('move', { space });
});
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && load());

load().catch((e) => say(e.message));
