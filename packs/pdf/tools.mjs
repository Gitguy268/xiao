// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// The PDF tools: what neither Firefox's own viewer (highlight, sign, add
// text and images, reorder, delete and merge pages) nor the file converter
// (convert, compress, split, rotate, OCR, watermark) already does. The list
// follows PDFCraft's (AGPL-3.0, ideas only, no code). Built on @cantoo/pdf-lib
// (MIT), pdf-lib with encryption. Each tool takes the file's bytes and its
// options and gives back the new file's bytes; nothing leaves the page.
import { degrees, PDFDocument, StandardFonts, rgb } from '@cantoo/pdf-lib';

const A4 = [595.28, 841.89];
const MM = 72 / 25.4;

async function open(bytes, password) {
  try {
    return await PDFDocument.load(bytes, password === undefined ? {} : { password });
  } catch (e) {
    if (/encrypt/i.test(e.message) && password === undefined) throw new Error('This PDF has a password. Unlock it first.');
    if (password !== undefined) throw new Error('That password does not open this PDF.');
    throw new Error(`This file could not be read as a PDF (${e.message}).`);
  }
}

// Lay `pages` (embedded) onto one sheet in a grid of cols × rows, each scaled to fit its cell.
function sheet(out, pages, [w, h], cols, rows) {
  const page = out.addPage([w, h]);
  const cw = w / cols, ch = h / rows;
  pages.forEach((p, i) => {
    if (!p) return;
    const s = Math.min(cw / p.width, ch / p.height);
    const col = i % cols, row = Math.floor(i / cols);
    page.drawPage(p, {
      x: col * cw + (cw - p.width * s) / 2,
      y: h - (row + 1) * ch + (ch - p.height * s) / 2,
      width: p.width * s,
      height: p.height * s,
    });
  });
}

// "1-3, 5, 8-" → zero-based page indexes in the order written, for a
// document of `count` pages. Throws on a page that isn't there.
export function parseRange(text, count) {
  const out = [];
  const parts = String(text ?? '').split(',').map((p) => p.trim()).filter(Boolean);
  if (!parts.length) throw new Error('Write the pages, e.g. 1-3, 5.');
  for (const part of parts) {
    const m = /^(\d*)\s*(-?)\s*(\d*)$/.exec(part);
    if (!m || (!m[1] && !m[3])) throw new Error(`"${part}" is not a page or a range.`);
    const from = m[1] ? Number(m[1]) : 1;
    const to = m[2] ? (m[3] ? Number(m[3]) : count) : from;
    if (from < 1 || to > count || from > to) throw new Error(`Pages ${part} are not in this ${count}-page PDF.`);
    for (let i = from; i <= to; i++) out.push(i - 1);
  }
  return out;
}

async function copyInto(out, src, indexes) {
  for (const page of await out.copyPages(src, indexes)) out.addPage(page);
}

export const TOOLS = {
  // This PDF first, then the others in the order chosen.
  async merge(bytes, { files = [] } = {}) {
    if (!files.length) throw new Error('Choose the PDFs to add after this one.');
    const out = await PDFDocument.create();
    for (const b of [bytes, ...files.map((f) => f.bytes)]) {
      const src = await open(b);
      await copyInto(out, src, src.getPageIndices());
    }
    return out.save();
  },

  // A new PDF with only these pages, in the order written.
  async extract(bytes, { pages } = {}) {
    const src = await open(bytes);
    const out = await PDFDocument.create();
    await copyInto(out, src, parseRange(pages, src.getPageCount()));
    return out.save();
  },

  async remove(bytes, { pages } = {}) {
    const src = await open(bytes);
    const gone = new Set(parseRange(pages, src.getPageCount()));
    const keep = src.getPageIndices().filter((i) => !gone.has(i));
    if (!keep.length) throw new Error('That would remove every page.');
    const out = await PDFDocument.create();
    await copyInto(out, src, keep);
    return out.save();
  },

  // Turn pages clockwise; every page when no pages are written.
  async rotate(bytes, { pages = '', angle = 90 } = {}) {
    const doc = await open(bytes);
    if (![90, 180, 270].includes(angle)) throw new Error('Turn by 90, 180 or 270 degrees.');
    const which = String(pages).trim() ? parseRange(pages, doc.getPageCount()) : doc.getPageIndices();
    for (const i of new Set(which)) {
      const page = doc.getPage(i);
      page.setRotation(degrees((page.getRotation().angle + angle) % 360));
    }
    return doc.save();
  },

  // 2 or 4 pages on each A4 sheet.
  async nup(bytes, { per = 2 } = {}) {
    const src = await open(bytes);
    const out = await PDFDocument.create();
    const pages = await out.embedPages(src.getPages());
    const [size, cols, rows] = per === 4 ? [A4, 2, 2] : [[A4[1], A4[0]], 2, 1];
    for (let i = 0; i < pages.length; i += per) sheet(out, pages.slice(i, i + per), size, cols, rows);
    return out.save();
  },

  // Saddle-stitched booklet: print both sides, fold the stack in half.
  async booklet(bytes) {
    const src = await open(bytes);
    const out = await PDFDocument.create();
    const pages = await out.embedPages(src.getPages());
    while (pages.length % 4) pages.push(null);
    const n = pages.length;
    for (let i = 0; i < n / 2; i += 2) {
      sheet(out, [pages[n - 1 - i], pages[i]], [A4[1], A4[0]], 2, 1);
      sheet(out, [pages[i + 1], pages[n - 2 - i]], [A4[1], A4[0]], 2, 1);
    }
    return out.save();
  },

  async numbers(bytes, { start = 1, where = 'bottom' } = {}) {
    const doc = await open(bytes);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    doc.getPages().forEach((page, i) => {
      const text = String(start + i);
      const { width, height } = page.getSize();
      const w = font.widthOfTextAtSize(text, 10);
      page.drawText(text, {
        x: where === 'bottom-right' ? width - 36 - w : (width - w) / 2,
        y: where === 'top' ? height - 28 : 20,
        size: 10,
        font,
        color: rgb(0.2, 0.2, 0.2),
      });
    });
    return doc.save();
  },

  // Trim the same margin off every side of every page (what is cut stays in the file).
  async crop(bytes, { mm = 10 } = {}) {
    const doc = await open(bytes);
    const m = Math.max(0, mm) * MM;
    for (const page of doc.getPages()) {
      const { x, y, width, height } = page.getCropBox();
      if (2 * m >= Math.min(width, height)) throw new Error('That margin is larger than the page.');
      page.setCropBox(x + m, y + m, width - 2 * m, height - 2 * m);
    }
    return doc.save();
  },

  async details(bytes, { title, author, subject, keywords } = {}) {
    const doc = await open(bytes);
    if (title !== undefined) doc.setTitle(title);
    if (author !== undefined) doc.setAuthor(author);
    if (subject !== undefined) doc.setSubject(subject);
    if (keywords !== undefined) doc.setKeywords(keywords.split(',').map((k) => k.trim()).filter(Boolean));
    return doc.save();
  },

  async protect(bytes, { password } = {}) {
    if (!password) throw new Error('Choose a password.');
    const doc = await open(bytes);
    doc.encrypt({ userPassword: password, ownerPassword: password });
    return doc.save();
  },

  // Saving a decrypted document keeps its encryption, so the pages move to a
  // fresh one (with its details); bookmarks and form fields are not carried.
  async unlock(bytes, { password = '' } = {}) {
    const src = await open(bytes, password);
    const out = await PDFDocument.create();
    for (const page of await out.copyPages(src, src.getPageIndices())) out.addPage(page);
    for (const [get, set] of [['getTitle', 'setTitle'], ['getAuthor', 'setAuthor'], ['getSubject', 'setSubject']]) {
      const value = src[get]();
      if (value) out[set](value);
    }
    return out.save();
  },

  async attach(bytes, { files = [] } = {}) {
    if (!files.length) throw new Error('Choose the files to attach.');
    const doc = await open(bytes);
    for (const f of files) await doc.attach(f.bytes, f.name, { mimeType: f.type || 'application/octet-stream' });
    return doc.save();
  },
};

export const pageCount = async (bytes) => (await open(bytes)).getPageCount();
