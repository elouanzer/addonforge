'use strict';

// The built-in QR encoder. Its output was checked by decoding it with macOS
// CoreImage for versions 1 to 32; the golden hashes below guard against regressions.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { encodeQr, renderQr } = require('../tools/lib/qr');

const version = (m) => (m.length - 17) / 4;
const hash = (m) => crypto.createHash('sha256').update(m.map((r) => r.map((b) => (b ? 1 : 0)).join('')).join('\n')).digest('hex').slice(0, 16);

test('picks the smallest version that fits (byte mode, level M)', () => {
  assert.equal(version(encodeQr('a')), 1);
  assert.equal(version(encodeQr('x'.repeat(14))), 1);
  assert.equal(version(encodeQr('x'.repeat(15))), 2);
  assert.equal(version(encodeQr('stremio://abc-def.trycloudflare.com/manifest.json')), 4);
  assert.equal(version(encodeQr('x'.repeat(1500))), 32);
});

test('finder patterns sit in three corners', () => {
  const m = encodeQr('stremio://example.com/manifest.json');
  const n = m.length;
  for (const [x0, y0] of [[0, 0], [n - 7, 0], [0, n - 7]]) {
    for (let i = 0; i < 7; i++) {
      assert.equal(m[y0][x0 + i], true, 'top edge dark');
      assert.equal(m[y0 + 6][x0 + i], true, 'bottom edge dark');
    }
    assert.equal(m[y0 + 1][x0 + 1], false, 'ring light');
    assert.equal(m[y0 + 3][x0 + 3], true, 'centre dark');
  }
  assert.equal(m[n - 8][8], true, 'dark module');
});

test('timing patterns alternate', () => {
  const m = encodeQr('timing');
  for (let i = 8; i < m.length - 8; i++) {
    assert.equal(m[6][i], i % 2 === 0);
    assert.equal(m[i][6], i % 2 === 0);
  }
});

test('golden outputs (verified with a real decoder)', () => {
  assert.equal(hash(encodeQr('stremio://127.0.0.1:7000/manifest.json')), GOLDEN.local);
  assert.equal(hash(encodeQr('x'.repeat(300))), GOLDEN.v13);
  assert.equal(hash(encodeQr('x'.repeat(1500))), GOLDEN.v32);
});

test('UTF-8 input is encoded as bytes', () => {
  assert.equal(version(encodeQr('é'.repeat(7))), 1, '14 bytes fit in version 1');
  assert.equal(version(encodeQr('é'.repeat(8))), 2, '16 bytes do not');
});

test('too long throws', () => {
  assert.throws(() => encodeQr('x'.repeat(3000)), /too long/);
});

test('terminal rendering: two module rows per line, with a quiet zone', () => {
  const lines = renderQr('a').split('\n');
  const size = 21 + 4;
  assert.equal(lines.length, Math.ceil(size / 2));
  for (const line of lines) assert.equal([...line].length, size);
  assert.equal(lines[0], '█'.repeat(size), 'quiet zone is light');
  assert.match(lines.join(''), /^[█▀▄ ]+$/);
});

/** Recorded from the encoder after the decode check. */
const GOLDEN = {
  local: 'f4a4f808d884e6f9',
  v13: 'a6c4c99a50e77d18',
  v32: 'ff343d666bcd7bc4',
};
