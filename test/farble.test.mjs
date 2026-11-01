import assert from 'node:assert/strict';
import { test } from 'node:test';
import { farblePixels, farbleSamples, pickCores, siteSalt } from '../core/lib/farble.mjs';

const wave = () => Float32Array.from({ length: 44100 }, (_, i) => Math.sin(i / 20));

test('a site keeps its values within a session, and other sites or sessions differ', () => {
  const same = siteSalt('seed', 'a.example');
  assert.equal(siteSalt('seed', 'a.example'), same);
  assert.notEqual(siteSalt('seed', 'b.example'), same);
  assert.notEqual(siteSalt('other', 'a.example'), same);
});

test('noise changes audio so little it cannot be heard, and repeats exactly', () => {
  const salt = siteSalt('seed', 'a.example');
  const a = farbleSamples(wave(), salt);
  const b = farbleSamples(wave(), salt);
  const plain = wave();
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, plain);
  assert.ok(a.every((v, i) => Math.abs(v - plain[i]) < 1e-5));
  assert.notDeepEqual(farbleSamples(wave(), siteSalt('seed', 'b.example')), a);
});

test('noise reaches a short buffer and spreads across a long one', () => {
  const salt = 12345;
  const short = farbleSamples(Float32Array.of(0.5, 0.5), salt);
  assert.notDeepEqual(short, Float32Array.of(0.5, 0.5));
  const long = farbleSamples(new Float32Array(1_000_000).fill(0.5), salt);
  assert.ok(long.filter((v) => v !== 0.5).length > 3000);
});

test('the core count never claims more than the machine has', () => {
  for (const real of [1, 2, 4, 8, 16]) {
    for (let salt = 0; salt < 200; salt++) {
      const n = pickCores(salt * 7919, real);
      assert.ok(n >= 2 && n <= Math.max(2, real), `${n} of ${real}`);
    }
  }
  assert.ok(new Set(Array.from({ length: 200 }, (_, s) => pickCores(s * 7919, 16))).size > 5);
});

test('image noise moves a colour by one step at most, keeps transparency, and repeats', () => {
  const image = () => {
    const d = new Uint8ClampedArray(400 * 4);
    for (let i = 0; i < 300 * 4; i += 4) d.set([0, 128, 255, 255], i); // the last quarter stays transparent
    return d;
  };
  const a = farblePixels(image(), 7);
  const plain = image();
  assert.deepEqual(a, farblePixels(image(), 7));
  assert.notDeepEqual(a, plain);
  assert.notDeepEqual(a, farblePixels(image(), 8));
  assert.ok(a.every((v, i) => Math.abs(v - plain[i]) <= 1));
  for (let i = 300 * 4; i < a.length; i++) assert.equal(a[i], 0);
  for (let i = 3; i < a.length; i += 4) assert.equal(a[i], plain[i]);
  assert.equal(farblePixels(new Uint8ClampedArray(0), 7).length, 0);
});

