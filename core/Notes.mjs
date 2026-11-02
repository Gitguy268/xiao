// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// The sticky note: a small square panel from its own toolbar button, off
// until it is switched on in the start page's settings.
//
// Notes are markdown files in one folder: <profile>/xiao-notes, or a folder
// the reader picks. The folder is the only copy, so there is nothing to sync:
// point it at the folder textarea's Folder sync uses, and both apps read and
// write the same files (textarea notices Xiao's edits by their mtime).
import { WRITE_TOOLS } from './lib/write.mjs';
import { lazy } from './mod.mjs';
import { nameFor, safeName, siteName, splitNote, allTags, tagsOf } from './lib/notes.mjs';

const customizable = lazy('browser/components/customizableui/CustomizableUI.sys.mjs', 'CustomizableUI');

const HTML = 'http://www.w3.org/1999/xhtml';
const PANEL = 'xiao-sticky-panel';
const FOLDER = 'xiao.notes.folder';
export const ORGANISE_URL = 'resource://xiao-notes-ai/organise.html';

export class Notes {
  constructor(xiao) {
    this.xiao = xiao;
  }

  dir() {
    return Services.prefs.getStringPref(FOLDER, '') || PathUtils.join(PathUtils.profileDir, 'xiao-notes');
  }

  folderLabel() {
    return Services.prefs.getStringPref(FOLDER, '');
  }

  // Every note, newest first, as { name, text } (text without front matter).
  async list() {
    const dir = this.dir();
    await IOUtils.makeDirectory(dir, { createAncestors: true });
    const files = (await IOUtils.getChildren(dir)).filter((p) => safeName(PathUtils.filename(p)));
    const notes = await Promise.all(files.map(async (p) => {
      try {
        const [stat, source] = await Promise.all([IOUtils.stat(p), IOUtils.readUTF8(p)]);
        return stat.type === 'regular' ? { name: PathUtils.filename(p), text: splitNote(source).text, at: stat.lastModified } : null;
      } catch {
        return null; // unreadable or gone: not a note this time
      }
    }));
    return notes.filter(Boolean).sort((a, b) => b.at - a.at).map(({ name, text }) => ({ name, text }));
  }

  // "Save to Clippings" on selected text: the words as a quote, and where they
  // came from, added to the end of Clippings.md.
  async clip({ text, title, url }) {
    const name = 'Clippings.md';
    const before = (await this.list()).find((n) => n.name === name)?.text ?? '# Clippings\n';
    const quote = text.trim().slice(0, 20_000).split('\n').map((line) => `> ${line}`).join('\n');
    const source = `[${(title || url).replace(/[[\]]/g, '').slice(0, 200)}](${url})`;
    return this.save({ name, text: `${before.trimEnd()}\n\n${quote}\n\n— ${source}\n` });
  }

  // Write a note's text, keeping any front matter its file already has.
  // A note without a name gets one from its first line. Returns { name }.
  async save({ name, text }) {
    if (typeof text !== 'string' || text.length > 2_000_000) throw new Error('not a note');
    const dir = this.dir();
    await IOUtils.makeDirectory(dir, { createAncestors: true });
    if (name == null) {
      if (!text.trim()) return { name: null };
      name = nameFor(text, new Set((await IOUtils.getChildren(dir)).map((p) => PathUtils.filename(p))));
    }
    if (!safeName(name)) throw new Error('not a note name');
    const path = PathUtils.join(dir, name);
    let head = '';
    try {
      head = splitNote(await IOUtils.readUTF8(path)).head;
    } catch {} // a new file
    await IOUtils.writeUTF8(path, head + text, { tmpPath: `${path}.tmp` });
    this.xiao.library?.notesChanged().catch((e) => console.error('Xiao Library: notes', e));
    return { name };
  }

  async chooseFolder(win) {
    const picker = Cc['@mozilla.org/filepicker;1'].createInstance(Ci.nsIFilePicker);
    picker.init(win.browsingContext, 'Keep sticky notes in', Ci.nsIFilePicker.modeGetFolder);
    const result = await new Promise((resolve) => picker.open(resolve));
    if (result !== Ci.nsIFilePicker.returnOK) return false;
    Services.prefs.setStringPref(FOLDER, picker.file.path);
    return true;
  }

  useProfile() {
    Services.prefs.clearUserPref(FOLDER);
  }

  // --- the toolbar button and its panel ---

  show(on) {
    // getWidget answers for any id; only an API widget is one Xiao created.
    const exists = customizable().getWidget('xiao-notes-button')?.provider === customizable().PROVIDER_API;
    if (on && !exists) {
      customizable().createWidget({
        id: 'xiao-notes-button',
        label: 'Sticky note',
        tooltiptext: 'Sticky note',
        defaultArea: customizable().AREA_NAVBAR,
        // CustomizableUI's command event may carry no target window.
        onCommand: (event) => this.open(event?.target?.ownerGlobal ?? Services.wm.getMostRecentWindow('navigator:browser')),
      });
    } else if (!on && exists) {
      customizable().destroyWidget('xiao-notes-button');
    }
  }

  // From the start page, a bang or the command bar: pressing it means wanting
  // the note, so this switches the feature on if it was off.
  async openFrom(win) {
    if (!this.xiao.features.sticky) await this.xiao.setFeature({ id: 'sticky', on: true });
    // The address bar closing its results would close a panel opened in the same moment.
    await new Promise((r) => setTimeout(r, 200));
    return this.open(win);
  }

  // The note is a popup of its own, not a toolbar sub-view: Zen tucks extra
  // buttons into its "…" menu, whose sub-views would squeeze the square.
  async open(win) {
    const doc = win.document;
    let panel = doc.getElementById(PANEL);
    if (!panel) {
      panel = doc.createXULElement('panel');
      panel.id = PANEL;
      panel.setAttribute('type', 'arrow');
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-label', 'Sticky note');
      panel.addEventListener('popuphidden', (e) => e.target === panel && this.flush?.());
      doc.getElementById('mainPopupSet').append(panel);
    }
    await this.fill(panel);
    const widget = customizable().getWidget('xiao-notes-button')?.forWindow(win);
    const anchor = widget?.overflowed ? doc.getElementById('nav-bar-overflow-button') : widget?.node;
    panel.openPopup(anchor?.checkVisibility?.() ? anchor : null, 'bottomleft topleft');
  }

  // Rewrite the note with the local AI, keeping the old text one click away.
  writingRow(el, paper, win) {
    const row = el('div', { class: 'xiao-sticky-writing' });
    const pick = el('select', { 'aria-label': 'Rewrite this note' });
    pick.append(el('option', { value: '' }, 'Rewrite…'), ...WRITE_TOOLS.map((t) => el('option', { value: t.id }, t.label)));
    const undo = el('button', { type: 'button', hidden: 'true' }, 'Undo');
    let before = null;
    const setText = (text) => {
      paper.textContent = text;
      paper.dispatchEvent(new win.InputEvent('input'));
    };
    pick.addEventListener('change', async () => {
      if (!pick.value) return;
      const tool = pick.value;
      pick.disabled = true;
      before = paper.innerText;
      try {
        setText(await this.xiao.rewriteNote({ tool, text: before }));
        undo.removeAttribute('hidden');
      } catch (e) {
        paper.title = e.message;
      } finally {
        pick.disabled = false;
        pick.value = '';
      }
    });
    undo.addEventListener('click', () => {
      setText(before);
      undo.setAttribute('hidden', 'true');
    });
    row.append(pick, undo);
    return row;
  }

  async fill(container) {
    const doc = container.ownerDocument;
    const win = doc.defaultView;
    const el = (tag, attrs = {}, text) => {
      const e = doc.createElementNS(HTML, tag);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
      if (text) e.textContent = text;
      return e;
    };

    const notes = await this.list();
    const host = win.gBrowser.selectedBrowser.currentURI;
    const site = this.xiao.features.perSite && /^https?$/.test(host.scheme) ? siteName(host.host) : null;
    let at = site ? notes.findIndex((n) => n.name === site) : 0;
    if (site && at < 0) {
      notes.unshift({ name: site, text: '', site: true });
      at = 0;
    }
    if (!notes.length) notes.push({ name: null, text: '' });

    const box = el('div', { class: 'xiao-sticky' });
    const paper = el('div', {
      class: 'xiao-sticky-text', contenteditable: 'plaintext-only', role: 'textbox', 'aria-multiline': 'true',
      'aria-label': 'Sticky note', spellcheck: 'true',
    });
    const row = el('div', { class: 'xiao-sticky-row' });
    const prev = el('button', { type: 'button', 'aria-label': 'Previous note' }, '←');
    const count = el('span', { class: 'xiao-sticky-count' });
    const next = el('button', { type: 'button', 'aria-label': 'Next note' }, '→');
    const add = el('button', { type: 'button', 'aria-label': 'New note' }, '+');
    const dot = el('span', { class: 'xiao-sticky-dot', role: 'status' });
    row.append(prev, count, next, add);
    if (await this.xiao.packs.installed('notes-ai')) {
      const mic = el('button', { type: 'button', class: 'xiao-sticky-mic', 'aria-label': 'Sort my notes by voice', title: 'Sort my notes by voice' });
      mic.addEventListener('click', () => {
        win.gBrowser.selectedTab = win.gBrowser.addTab(ORGANISE_URL, { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
        container.hidePopup?.();
      });
      row.append(mic);
    }
    row.append(dot);
    const tags = el('div', { class: 'xiao-sticky-tags' });
    box.append(paper, tags, row);
    if (this.xiao.features.noteWriting && await this.xiao.assist.model()) box.append(this.writingRow(el, paper, win));
    container.replaceChildren(box);

    let timer = null;
    const mark = (unsaved) => {
      dot.hidden = !unsaved;
      dot.setAttribute('aria-label', unsaved ? 'Not saved yet' : 'Saved');
      dot.title = unsaved ? 'Not saved yet' : 'Saved';
    };
    const save = async () => {
      clearTimeout(timer);
      timer = null;
      const note = notes[at];
      note.text = paper.innerText.replace(/\n$/, '');
      try {
        note.name = (await this.save(note)).name;
        mark(false);
      } catch (e) {
        dot.title = `Not saved: ${e.message}`;
      }
    };
    this.flush = () => timer && save();
    // Each tag in any note jumps to the next note that has it.
    const drawTags = () => {
      tags.replaceChildren(...allTags(notes).map((tag) => {
        const chip = el('button', { type: 'button', class: 'xiao-sticky-tag' }, tag);
        chip.addEventListener('click', () => {
          const next = notes.findIndex((n, i) => i > at && tagsOf(n.text).includes(tag));
          const found = next >= 0 ? next : notes.findIndex((n) => tagsOf(n.text).includes(tag));
          if (found >= 0) go(found);
        });
        return chip;
      }));
    };
    const show = () => {
      drawTags();
      paper.textContent = notes[at].text;
      count.textContent = site && at === 0 ? 'This site' : `${at + 1} of ${notes.length}`;
      prev.disabled = at === 0;
      next.disabled = at === notes.length - 1;
      mark(false);
    };
    const go = async (i) => {
      if (timer) await save();
      at = i;
      show();
      paper.focus();
    };
    paper.addEventListener('input', () => {
      mark(true);
      clearTimeout(timer);
      timer = win.setTimeout(save, 400);
    });
    prev.addEventListener('click', () => go(at - 1));
    next.addEventListener('click', () => go(at + 1));
    add.addEventListener('click', () => {
      notes.splice(at + 1, 0, { name: null, text: '' });
      go(at + 1);
    });
    show();
    win.setTimeout(() => paper.focus(), 0);
  }
}
