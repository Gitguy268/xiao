import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PDFDocument, PDFName } from '@cantoo/pdf-lib';
import { pageCount, TOOLS } from '../packs/pdf/tools.mjs';

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
