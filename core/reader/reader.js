// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// EPUB and PDF from this computer. An EPUB chapter is laid out in columns, one
// or two to a screen, and turning a page scrolls by a screen. A PDF opens in
// Firefox's own viewer, which has its own two-page view.
import { chapterHtml, openEpub } from './epub.mjs';

const $ = (id) => document.getElementById(id);
const say = (t) => { $('status').textContent = t; $('status').hidden = !t; };
let book = null;
let at = 0;
let pdfUrl = null;

const PAGE_STYLE = (spread) => `<style>
  html { height: 100%; overflow: hidden; }
  body { margin: 0; padding: 32px; box-sizing: border-box; height: 100vh;
    column-count: ${spread}; column-gap: 48px; column-fill: auto;
    font: 18px / 1.6 Georgia, 'Times New Roman', serif; color: #1a1a1a; background: #fff; overflow-wrap: anywhere; }
  img, svg { max-width: 100%; max-height: 90vh; }
</style>`;
const frame = () => $('page').contentWindow;
const turnBy = () => frame().innerWidth;

async function show(index, end = false) {
  at = index;
  $('chapter').value = index;
  const html = await chapterHtml(book, book.spine[index]);
  const page = $('page');
  await new Promise((done) => {
    page.onload = done;
    page.srcdoc = `<!doctype html>${html.replace(/<head[^>]*>/i, (h) => `${h}${PAGE_STYLE($('spread').value)}`)}`;
  });
  frame().document.documentElement.scrollLeft = 0;
  if (end) frame().document.documentElement.scrollLeft = frame().document.documentElement.scrollWidth;
}

function turn(direction) {
  if (!book) return;
  const root = frame().document.documentElement;
  const next = root.scrollLeft + direction * turnBy();
  if (next < 0) {
    if (at > 0) show(at - 1, true);
  } else if (next >= root.scrollWidth - 4) {
    if (at < book.spine.length - 1) show(at + 1);
  } else {
    root.scrollLeft = next;
  }
}

function resetPdf() {
  if (pdfUrl) URL.revokeObjectURL(pdfUrl);
  pdfUrl = null;
  $('pdf').hidden = true;
  $('pdf').removeAttribute('src');
}

function openPdf(file) {
  book = null;
  resetPdf();
  pdfUrl = URL.createObjectURL(file);
  $('pdf').src = `${pdfUrl}#spreadmode=${$('spread').value === '2' ? 1 : 0}`;
  $('pdf').hidden = false;
  $('page').hidden = true;
  $('title').textContent = file.name;
  $('chapter').disabled = $('prev').disabled = $('next').disabled = true;
  say('');
}

async function open(file) {
  if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') return openPdf(file);
  resetPdf();
  book = await openEpub(new Uint8Array(await file.arrayBuffer()));
  if (!book.spine.length) throw new Error('That EPUB has no chapters.');
  $('title').textContent = book.title;
  $('chapter').replaceChildren(...book.spine.map((item, i) => {
    const o = document.createElement('option');
    o.value = i;
    o.textContent = `${i + 1}. ${item.href.split('/').pop().replace(/\.x?html?$/i, '')}`;
    return o;
  }));
  $('chapter').disabled = $('prev').disabled = $('next').disabled = false;
  $('page').hidden = false;
  say('');
  await show(0);
}

const guard = (p) => p.catch((e) => say(e.message));
$('file').addEventListener('change', (e) => e.target.files[0] && guard(open(e.target.files[0])));
$('prev').addEventListener('click', () => turn(-1));
$('next').addEventListener('click', () => turn(1));
$('chapter').addEventListener('change', (e) => guard(show(Number(e.target.value))));
$('spread').addEventListener('change', () => book && guard(show(at)));
addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') turn(-1);
  if (e.key === 'ArrowRight') turn(1);
});
window.xiaoReader = { open, turn, get at() { return at; }, get book() { return book; } }; // for the e2e
