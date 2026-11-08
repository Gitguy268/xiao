// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Xiao Assist: help with pages, tabs and file names, off until switched on.
//
// Without AI: tidy tab titles, tabs grouped by site, and "ask about this
// page" showing the passages that answer it. With the local AI (MiniCPM5,
// the voice organiser's download): written answers that cite those
// passages, link summaries and file name suggestions.
//
// The model runs in a hidden tab of its own (a separate content process),
// started for the first job and closed two minutes after the last, which
// gives its memory back. One job at a time; cancelling one closes the hidden
// tab, so the work really stops. Only what the reader picked goes in: the
// page they asked about (or its selection) and any tabs they mention, never
// other tabs or files, and never private windows or Tor tabs. Nothing leaves
// the computer.
//
// Model output is only ever shown, or offered as a name for the reader to
// accept in the Library's review: it never acts.
import { groupBySite, nameMessages, passagesOf, rankPassages, readAnswer, readName, summaryMessages, textOfHtml, tidyTitle } from './lib/assist.mjs';
import { applySkill, askAcrossMessages, chatEntry, isSkill, newSkillNote, numberAcross, skillFile, skillName, skillPrompt } from './lib/assist-more.mjs';
import { lazy } from './mod.mjs';
import { everyTab } from './tabs.mjs';

const hidden = lazy('toolkit/modules/HiddenFrame.sys.mjs', 'HiddenBrowserManager');
const privateBrowsing = lazy('toolkit/modules/PrivateBrowsingUtils.sys.mjs', 'PrivateBrowsingUtils');
export const HOST_URL = 'resource://xiao-notes-ai/assist-host.html';
export const ASSIST_URL = 'resource://xiao/assist/index.html';
const TIMEOUT = 5 * 60_000;

const abort = (message = 'Cancelled.') => Object.assign(new Error(message), { name: 'AbortError' });

export class Assist {
  queue = [];
  jobs = new Map();
  idleMs = 2 * 60_000;
  titled = new WeakMap(); // tab → the title it had before Xiao tidied it
  groupsMade = []; // the last tidy: [{ folder, pinned: tabs Xiao pinned }]

  constructor(xiao) {
    this.xiao = xiao;
  }

  get on() {
    return this.xiao.features.assist === true;
  }

  // The local AI: switched on, and its download there.
  async model() {
    return this.on && (await this.xiao.packs.installed('notes-ai'));
  }

  // --- the model's queue ---

  // Runs one chat on the local model: resolves with what it wrote.
  async run(messages, { signal } = {}) {
    if (this.engine) return this.engine(messages, { signal }); // a stand-in, set only by tests
    if (!(await this.model())) throw new Error('The local AI is off.');
    if (signal?.aborted) throw abort();
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.cancel(id, 'The local AI took too long and was stopped.'), TIMEOUT);
      const job = { id, messages, progress: 'Waiting for the local AI…', resolve, reject, timer };
      signal?.addEventListener('abort', () => this.cancel(id), { once: true });
      this.jobs.set(id, job);
      this.queue.push(job);
      this.startHost();
      this.feed();
    });
  }

  feed() {
    if (!this.waiting || !this.queue.length) return;
    clearTimeout(this.idle); // a waiting host is about to work: its idle countdown must not stop it mid-answer
    const take = this.waiting;
    this.waiting = null;
    const job = this.queue.shift();
    this.running = job.id;
    take({ id: job.id, messages: job.messages });
  }

  // The hidden tab: started for the first job, closed when idle or cancelled.
  startHost() {
    if (this.hosting) return;
    this.hosting = hidden().withHiddenBrowser(async (browser) => {
      this.browser = browser;
      browser.loadURI(Services.io.newURI(HOST_URL), { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
      await new Promise((resolve) => (this.release = resolve));
    }, { messageManagerGroup: 'browsers' }).catch((e) => console.error('Xiao Assist: host', e)).finally(() => {
      this.browser = null;
      this.release = null;
      this.hosting = null;
      this.running = null;
      this.stopping = false;
      // a job that was running when the host went is failed, never left hanging
      for (const job of this.jobs.values()) if (!this.queue.includes(job)) this.finish(job.id, { error: 'The local AI stopped.' });
      if (this.queue.length) this.startHost();
    });
  }

  stopHost() {
    clearTimeout(this.idle);
    // until the host is gone it may still ask for work; a new question waits for the next host
    if (this.hosting) this.stopping = true;
    const take = this.waiting;
    this.waiting = null;
    take?.(null);
    this.release?.();
  }

  cancel(id, message) {
    const job = this.jobs.get(id);
    if (!job) return;
    this.queue = this.queue.filter((j) => j !== job);
    const wasRunning = this.running === id;
    this.finish(id, { error: message, aborted: !message });
    if (wasRunning) this.stopHost(); // the only way to stop a model mid-answer
  }

  finish(id, { text, error, aborted }) {
    const job = this.jobs.get(id);
    if (!job) return;
    this.jobs.delete(id);
    clearTimeout(job.timer);
    if (this.running === id) this.running = null;
    if (aborted) job.reject(abort());
    else if (error) job.reject(new Error(error));
    else job.resolve(text);
  }

  // Calls from the hidden tab's page (see XiaoParent: only that page, in that tab).
  host(name, data) {
    if (name === 'assist.next') {
      if (this.stopping) return null; // a host on its way out takes nothing more
      clearTimeout(this.idle);
      if (this.queue.length) {
        const job = this.queue.shift();
        this.running = job.id;
        return { id: job.id, messages: job.messages };
      }
      this.idle = setTimeout(() => this.stopHost(), this.idleMs);
      return new Promise((resolve) => (this.waiting = resolve));
    }
    if (name === 'assist.progress') {
      const job = this.jobs.get(data?.id);
      if (job && typeof data.text === 'string') job.progress = data.text.slice(0, 200);
      return true;
    }
    if (name === 'assist.done') {
      this.finish(data?.id, { text: typeof data?.text === 'string' ? data.text : null, error: data?.error ? String(data.error).slice(0, 300) : null });
      return true;
    }
    throw new Error(`unknown call ${name}`);
  }

  status() {
    const job = this.jobs.get(this.running) ?? this.queue[0];
    return { busy: !!job, progress: job?.progress ?? '', loaded: !!this.browser };
  }

  // --- the page the reader asked about ---

  // The tab behind a browserId, if Assist may read it: a normal tab showing a web page.
  tabFor(browserId) {
    for (const win of Services.wm.getEnumerator('navigator:browser')) {
      if (privateBrowsing().isWindowPrivate(win)) continue;
      const tab = everyTab(win).find((t) => t.linkedBrowser.browserId === browserId);
      if (!tab) continue;
      if (tab.userContextId === this.xiao.tor.torId) throw new Error('Assist does not read Tor tabs.');
      if (!/^https?:/.test(tab.linkedBrowser.currentURI.spec)) throw new Error('Assist reads web pages only.');
      return tab;
    }
    throw new Error('That tab is closed, or in a private window.');
  }

  async passages(browserId) {
    const tab = this.tabFor(browserId);
    const actor = tab.linkedBrowser.browsingContext.currentWindowGlobal?.getActor('Xiao');
    if (!actor) throw new Error('The page is not loaded.');
    const { title, text, selection } = await actor.sendQuery('extract');
    return { title, selection, passages: passagesOf(text) };
  }

  // The passages that answer, at once and without the model: the page shows
  // these while the model writes. extra: other tabs the reader mentioned
  // (browserIds, at most five), read the same way and numbered after this page.
  async evidence(browserId, question, extra = []) {
    const ids = [browserId, ...new Set(extra.filter((id) => Number.isSafeInteger(id) && id !== browserId))].slice(0, 6);
    const pages = [];
    for (const id of ids) {
      const p = await this.passages(id);
      pages.push({ title: p.title, url: this.tabFor(id).linkedBrowser.currentURI.spec, passages: p.passages, selection: p.selection });
    }
    const { asked, question: q } = applySkill(question, await this.skills());
    const wanted = asked ?? q;
    return {
      title: pages[0].title,
      selection: pages[0].selection,
      titles: pages.map((p) => p.title),
      urls: pages.map((p) => p.url),
      evidence: rankPassages(numberAcross(pages), wanted, ids.length > 1 ? 8 : 6),
    };
  }

  // question may start with "/skill": its note's instructions are added.
  async ask(browserId, question, { signal, extra = [] } = {}) {
    const found = await this.evidence(browserId, question, extra);
    const { title, selection, evidence, titles } = found;
    if (!(await this.model()) && !this.engine) return { ...found, answer: null };
    if (!evidence.length) return { ...found, answer: { text: 'The page does not say.', cites: [], said: 'not on page' } };
    const { question: q } = applySkill(question, await this.skills());
    const answer = readAnswer(await this.run(askAcrossMessages(q, evidence, titles, this.xiao.store.assistStyle), { signal }), evidence);
    if (this.xiao.features.assistChats && answer.said !== 'not on page') {
      this.saveChat({ question, answer: answer.text, titles, urls: found.urls }).catch((e) => console.error('Xiao: Assist chat', e));
    }
    return { title, selection, evidence, titles, answer };
  }

  // --- Skills, mentions and saved chats (0.6) ---

  async skills() {
    return (await this.xiao.notes.list()).filter((n) => isSkill(n.name))
      .map((n) => ({ name: skillName(n.name), file: n.name, prompt: skillPrompt(n.text) })).filter((s) => s.prompt);
  }

  async newSkill(name, does) {
    const file = skillFile(name);
    if (!file) throw new Error('A skill needs a name.');
    if ((await this.skills()).some((s) => s.file.toLowerCase() === file.toLowerCase())) throw new Error('There is a skill with that name already.');
    await this.xiao.notes.save({ name: file, text: newSkillNote(name, does) });
    return skillName(file);
  }

  async saveChat(entry) {
    const name = 'Assist chats.md';
    const before = (await this.xiao.notes.list()).find((n) => n.name === name)?.text ?? '# Assist chats\n';
    await this.xiao.notes.save({ name, text: `${before.trimEnd()}\n\n${chatEntry(entry)}` });
  }

  // Tabs and Zen folders the reader can mention: normal tabs showing web
  // pages, never Tor tabs or private windows, and not the page itself.
  mentionable(browserId) {
    const tabs = [];
    const folders = new Map();
    for (const win of Services.wm.getEnumerator('navigator:browser')) {
      if (privateBrowsing().isWindowPrivate(win)) continue;
      for (const tab of everyTab(win)) {
        const b = tab.linkedBrowser;
        if (tab.userContextId === this.xiao.tor.torId || !/^https?:/.test(b?.currentURI?.spec ?? '') || b.browserId === browserId) continue;
        tabs.push({ id: b.browserId, title: tab.label });
        const folder = tab.group?.label;
        if (folder) folders.set(folder, [...(folders.get(folder) ?? []), b.browserId]);
      }
    }
    return { tabs, folders: [...folders].map(([label, ids]) => ({ label, ids })) };
  }

  // Shows a passage in the page: scrolled to and selected.
  async show(browserId, text) {
    const actor = this.tabFor(browserId).linkedBrowser.browsingContext.currentWindowGlobal?.getActor('Xiao');
    return actor?.sendQuery('show', { text: String(text).slice(0, 120) });
  }

  // A link's page, fetched on the reader's request without cookies, read as text.
  async summarize(url, { signal } = {}) {
    if (!/^https?:\/\//.test(url)) throw new Error('Only web links can be summarised.');
    const r = await this.xiao.silent.asking([new URL(url).host], () => fetch(url, { credentials: 'omit', redirect: 'follow', signal })); // the reader chose this link
    if (!r.ok) throw new Error(`The page answered ${r.status}.`);
    if (!/text\/html|text\/plain/.test(r.headers.get('content-type') ?? '')) throw new Error('That link is not a page of text.');
    const html = (await r.text()).slice(0, 2_000_000);
    const title = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]?.trim() ?? url;
    const passages = passagesOf(textOfHtml(html)).slice(0, 12);
    if (!(await this.model()) && !this.engine) return { title, evidence: passages.slice(0, 4), answer: null };
    return { title, evidence: passages, answer: readAnswer(await this.run(summaryMessages(passages, title), { signal }), passages) };
  }

  // A better name for a file, from the local AI, checked like a typed one; null to keep it.
  async suggestName(name, host) {
    return readName(await this.run(nameMessages(name, host)), name);
  }

  // Opens Assist beside the tab it is about (Zen split view), or after it.
  open(win, tab, { summarize } = {}) {
    const url = `${ASSIST_URL}?tab=${tab.linkedBrowser.browserId}${summarize ? `&summarize=${encodeURIComponent(summarize)}` : ''}`;
    const side = win.gBrowser.addTab(url, { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
    try {
      win.gZenViewSplitter.splitTabs([tab, side], 'vsep', 1);
    } catch {
      win.gBrowser.selectedTab = side;
    }
    return side;
  }

  // --- tidy tabs, without a model ---

  // Shorter titles for this window's tabs; titles the reader set stay.
  tidyTitles(win) {
    let changed = 0;
    for (const tab of win.gBrowser.tabs) {
      if (tab.zenStaticLabel && !this.titled.has(tab)) continue; // named by the reader
      const uri = tab.linkedBrowser.currentURI;
      const next = /^https?$/.test(uri.scheme) ? tidyTitle(tab.label, uri.host) : null;
      if (!next || next === tab.label) continue;
      if (!this.titled.has(tab)) this.titled.set(tab, tab.label);
      tab.zenStaticLabel = next;
      win.gBrowser._setTabLabel(tab, next, { _zenChangeLabelFlag: true });
      changed++;
    }
    return changed;
  }

  untidyTitles(win) {
    let restored = 0;
    for (const tab of win.gBrowser.tabs) {
      if (!this.titled.has(tab)) continue;
      this.titled.delete(tab);
      delete tab.zenStaticLabel;
      win.gBrowser.setTabTitle(tab);
      restored++;
    }
    return restored;
  }

  // Groups to suggest: this window's ordinary tabs, by site.
  groups(win) {
    const tabs = win.gBrowser.tabs.filter((t) => !t.pinned && !t.hasAttribute('zen-essential') && !t.hasAttribute('zen-glance-tab')
      && t.userContextId !== this.xiao.tor.torId && /^https?$/.test(t.linkedBrowser.currentURI.scheme));
    return groupBySite(tabs.map((t, i) => ({ id: i, host: t.linkedBrowser.currentURI.host, tab: t })))
      .map((g) => ({ label: g.label, tabs: g.ids.map((i) => tabs[i]) }));
  }

  // Makes the suggested groups into Zen folders, once; undoTidy puts them back.
  makeGroups(win, groups) {
    this.groupsMade = [];
    for (const g of groups) {
      const pinned = g.tabs.filter((t) => !t.pinned);
      const folder = win.gZenFolders.createFolder(g.tabs, { label: g.label });
      if (folder) this.groupsMade.push({ folder, pinned });
    }
    return this.groupsMade.length;
  }

  async undoGroups(win) {
    let undone = 0;
    for (const { folder, pinned } of this.groupsMade.reverse()) {
      if (!folder.isConnected) continue;
      await folder.unpackTabs();
      for (const tab of pinned) if (tab.isConnected && tab.pinned) win.gBrowser.unpinTab(tab);
      if (folder.isConnected && !folder.allItems?.length) await win.gBrowser.removeTabGroup(folder);
      undone++;
    }
    this.groupsMade = [];
    return undone;
  }
}
