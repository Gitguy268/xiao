// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Reads an EPUB with what the browser already has: a ZIP directory walk, plus
// DecompressionStream for the deflated files. Book content is untrusted; the
// reader shows it in a frame that can't run scripts and strips what could load
// anything from the network, so opening a book never connects to anything.

export function readZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0) throw new Error('That file is not an EPUB.');
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const files = new Map();
  for (let i = 0; i < count; i++) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error('That EPUB is damaged.');
    const method = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extra = view.getUint16(at + 30, true);
    const comment = view.getUint16(at + 32, true);
    const offset = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
    files.set(name, { method, size, offset });
    at += 46 + nameLength + extra + comment;
  }
  return {
    has: (name) => files.has(name),
    async read(name) {
      const f = files.get(name);
      if (!f) throw new Error(`The EPUB is missing ${name}.`);
      const start = f.offset + 30 + view.getUint16(f.offset + 26, true) + view.getUint16(f.offset + 28, true);
      const raw = bytes.subarray(start, start + f.size);
      if (f.method === 0) return raw;
      if (f.method !== 8) throw new Error('This EPUB is packed in a way Xiao can\'t read.');
      const out = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(out).arrayBuffer());
    },
  };
}

const text = (bytes) => new TextDecoder().decode(bytes);
export const resolvePath = (base, href) => {
  const parts = [...base.split('/').slice(0, -1), ...decodeURI(href.split('#')[0]).split('/')];
  const out = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p && p !== '.') out.push(p);
  }
  return out.join('/');
};

export async function openEpub(bytes, parse = (s, type) => new DOMParser().parseFromString(s, type)) {
  const zip = readZip(bytes);
  const container = parse(text(await zip.read('META-INF/container.xml')), 'application/xml');
  const opfPath = container.querySelector('rootfile')?.getAttribute('full-path');
  if (!opfPath) throw new Error('That EPUB is damaged.');
  const opf = parse(text(await zip.read(opfPath)), 'application/xml');
  const items = new Map([...opf.querySelectorAll('manifest > item')].map((i) => [i.getAttribute('id'), { href: resolvePath(opfPath, i.getAttribute('href')), type: i.getAttribute('media-type') }]));
  const spine = [...opf.querySelectorAll('spine > itemref')].map((r) => items.get(r.getAttribute('idref'))).filter(Boolean);
  const title = opf.querySelector('metadata > title, metadata > *|title')?.textContent?.trim() || 'Untitled book';
  return { title, spine, zip, types: new Map([...items.values()].map((i) => [i.href, i.type])) };
}

// A chapter as a clean document: no scripts, forms or frames, no outside
// addresses, and pictures and stylesheets from the book itself put inline.
export async function chapterHtml(book, item, parse = (s, type) => new DOMParser().parseFromString(s, type)) {
  const doc = parse(text(await book.zip.read(item.href)), 'text/html');
  doc.querySelectorAll('script, iframe, object, embed, form, base, meta[http-equiv], audio, video, source, track').forEach((e) => e.remove());
  for (const e of doc.querySelectorAll('*')) {
    for (const a of [...e.attributes]) {
      if (/^on/i.test(a.name) || (/^(href|src|srcset|xlink:href|poster|background)$/i.test(a.name) && /^[a-z][a-z0-9+.-]*:/i.test(a.value) && !a.value.startsWith('data:'))) e.removeAttribute(a.name);
    }
  }
  const inline = async (href) => {
    const path = resolvePath(item.href, href);
    if (!book.zip.has(path)) return null;
    const type = book.types.get(path) ?? 'application/octet-stream';
    const bytes = await book.zip.read(path);
    return { type, bytes };
  };
  for (const img of doc.querySelectorAll('img[src], image')) {
    const attr = img.hasAttribute('src') ? 'src' : 'xlink:href';
    const href = img.getAttribute(attr);
    const found = href && !href.startsWith('data:') && await inline(href);
    if (found) img.setAttribute(attr, URL.createObjectURL(new Blob([found.bytes], { type: found.type })));
    else if (href && !href.startsWith('data:')) img.removeAttribute(attr);
  }
  for (const link of doc.querySelectorAll('link')) {
    const found = link.rel === 'stylesheet' && link.getAttribute('href') && await inline(link.getAttribute('href'));
    if (found) {
      const style = doc.createElement('style');
      style.textContent = text(found.bytes).replace(/url\([^)]*\)|@import[^;]*;/g, '');
      link.replaceWith(style);
    } else link.remove();
  }
  for (const style of doc.querySelectorAll('style')) style.textContent = style.textContent.replace(/url\([^)]*\)|@import[^;]*;/g, '');
  return doc.documentElement.outerHTML;
}
