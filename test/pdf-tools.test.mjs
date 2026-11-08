import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PDFDocument, PDFName } from '@cantoo/pdf-lib';
import { pageCount, parseRange, TOOLS } from '../packs/pdf/tools.mjs';

async function pdf(n) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < n; i++) doc.addPage([300, 400]).drawText(`page ${i + 1}`, { x: 20, y: 200 });
  return doc.save();
}

test('pages per sheet and booklets make the right number of sheets', async () => {
  const five = await pdf(5);
  assert.equal(await pageCount(await TOOLS.nup(five, { per: 2 })), 3);
  assert.equal(await pageCount(await TOOLS.nup(five, { per: 4 })), 2);
  assert.equal(await pageCount(await TOOLS.booklet(five)), 4, '5 pages pad to 8: two sheets, both sides');
});

test('numbers, crop and details keep every page', async () => {
  const three = await pdf(3);
  assert.equal(await pageCount(await TOOLS.numbers(three, { start: 7 })), 3);
  const cropped = await PDFDocument.load(await TOOLS.crop(three, { mm: 10 }));
  assert.ok(Math.abs(cropped.getPage(0).getCropBox().width - (300 - 2 * 10 * 72 / 25.4)) < 0.01);
  await assert.rejects(TOOLS.crop(three, { mm: 200 }), /larger than the page/);
  const named = await PDFDocument.load(await TOOLS.details(three, { title: 'Report', keywords: 'a, b' }));
  assert.equal(named.getTitle(), 'Report');
});

test('a password locks the file, and only that password unlocks it', async () => {
  const locked = await TOOLS.protect(await pdf(2), { password: 'hunter2' });
  await assert.rejects(pageCount(locked), /has a password/);
  await assert.rejects(TOOLS.unlock(locked, { password: 'wrong' }), /does not open/);
  const open = await TOOLS.unlock(locked, { password: 'hunter2' });
  assert.equal(await pageCount(open), 2, 'opens with no password at all');
  await assert.rejects(TOOLS.protect(await pdf(1), {}), /Choose a password/);
});

test('attachments ride along', async () => {
  const out = await TOOLS.attach(await pdf(1), { files: [{ name: 'notes.txt', type: 'text/plain', bytes: new TextEncoder().encode('hi') }] });
  const doc = await PDFDocument.load(out);
  assert.ok(doc.catalog.lookup(PDFName.of('Names')), 'the file has an attachments table');
});

test('page ranges read like people write them', () => {
  assert.deepEqual(parseRange('1-3, 5', 6), [0, 1, 2, 4]);
  assert.deepEqual(parseRange('5-', 6), [4, 5]);
  assert.deepEqual(parseRange('-2', 6), [0, 1]);
  assert.deepEqual(parseRange('3,1', 6), [2, 0], 'in the order written');
  assert.throws(() => parseRange('7', 6), /not in this 6-page PDF/);
  assert.throws(() => parseRange('a', 6), /not a page or a range/);
  assert.throws(() => parseRange('', 6), /Write the pages/);
});

test('merge, extract, remove and rotate move whole pages', async () => {
  const text = async (bytes) => (await PDFDocument.load(bytes)).getPages().map((p) => p.getSize().width);
  const merged = await TOOLS.merge(await pdf(2), { files: [{ name: 'b.pdf', bytes: await pdf(3) }] });
  assert.equal(await pageCount(merged), 5);
  await assert.rejects(TOOLS.merge(await pdf(1), {}), /Choose the PDFs/);
  assert.equal(await pageCount(await TOOLS.extract(merged, { pages: '2-3, 5' })), 3);
  assert.equal(await pageCount(await TOOLS.remove(merged, { pages: '1, 4-5' })), 2);
  await assert.rejects(TOOLS.remove(await pdf(2), { pages: '1-2' }), /every page/);
  const turned = await PDFDocument.load(await TOOLS.rotate(await pdf(3), { pages: '2', angle: 90 }));
  assert.deepEqual(turned.getPages().map((p) => p.getRotation().angle), [0, 90, 0]);
  const all = await PDFDocument.load(await TOOLS.rotate(await pdf(2), { angle: 180 }));
  assert.deepEqual(all.getPages().map((p) => p.getRotation().angle), [180, 180]);
  assert.equal((await text(merged)).length, 5);
});
