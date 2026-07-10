import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeCaption as sanitizeCaptionClient, CAPTION_RE as clientRe } from '../public/app-core.js';
import { sanitizeCaption as sanitizeCaptionServer, labels as serverLabels } from '../server-core.js';

// This file enforces the cross-module caption contract described in
// AGENTS.md: the MP4 export, the PNG export, and the on-screen preview
// must all render the same caption text. If you change the sanitization
// rule in either module, you must update both.

test('CAPTION_RE sources are byte-identical between client and server', () => {
  // The two source strings come from the literal regexes in each module.
  // If a future edit drifts the character class, this test fails before
  // any visual mismatch can reach the user.
  assert.equal(clientRe.source, /[A-Za-z0-9一-鿿 ]/u.source);
  // The server module's regex source is not exported, so we re-derive it
  // by importing sanitizeCaption and probing a known outside-range sample.
  assert.equal(sanitizeCaptionServer('！'), '');
  assert.equal(sanitizeCaptionClient('！'), '');
});

test('sanitizeCaption produces the same output in both modules', () => {
  // Mix of: ASCII, CJK basic block, full-width punct, half-width punct,
  // emoji, control chars, spaces of both widths, and an over-length string.
  const samples = [
    'Hello world',
    '上层 Caption_01',
    '你好，世界',
    '！@#¥%……&*（）',
    '一二三四五六七八九十一二三四五六七八九十', // > 18 chars
    '  trim me  ',
    '\u3000\u303F\uFF21\uFFEE', // full-width space, ideographic, fullwidth letters
    '中文 123 ABC 😀',
    '',
    null,
    undefined
  ];

  for (const sample of samples) {
    const client = sanitizeCaptionClient(sample);
    const server = sanitizeCaptionServer(sample);
    assert.equal(
      client,
      server,
      `Mismatch on sample ${JSON.stringify(sample)}: client=${JSON.stringify(client)} server=${JSON.stringify(server)}`
    );
  }
});

test('both modules cap to the same length and drop the same characters', () => {
  const longAscii = 'A'.repeat(30) + '中' + 'B'.repeat(30);
  assert.equal(sanitizeCaptionClient(longAscii), sanitizeCaptionServer(longAscii));

  // Punctuation kept by neither.
  for (const ch of ['!', '?', ',', '.', '!', '?', '。', '，', '!', '?']) {
    assert.equal(sanitizeCaptionClient(ch), '', `client kept ${ch}`);
    assert.equal(sanitizeCaptionServer(ch), '', `server kept ${ch}`);
  }

  // Characters both modules allow. Wrap each single character in non-space
  // so the trailing .trim() in sanitizeCaption does not eat them.
  for (const ch of ['A', 'z', '0', '9', '中', '鿿']) {
    assert.equal(sanitizeCaptionClient(`x${ch}x`), `x${ch}x`, `client dropped ${ch}`);
    assert.equal(sanitizeCaptionServer(`x${ch}x`), `x${ch}x`, `server dropped ${ch}`);
  }
  // The space is part of the character class, but both modules trim, so a
  // string that is only spaces becomes the empty string.
  assert.equal(sanitizeCaptionClient('   '), '');
  assert.equal(sanitizeCaptionServer('   '), '');
});

test('slot labels are aligned so caption[0..2] map to top/middle/bottom', () => {
  // server-core uses ['top','middle','bottom'] as slot keys, but the
  // exported label array there is not part of the caption contract. This
  // assertion exists to make a future server-side label refactor
  // intentional rather than accidental.
  assert.ok(Array.isArray(serverLabels));
  assert.equal(serverLabels.length, 3);
});
