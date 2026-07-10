import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeSampleStrip,
  expectedColorsAt,
  hexToRgb,
  validateProbeResult,
  validateSampleColors
} from '../scripts/smoke-core.js';

test('expectedColorsAt follows source starts and wraps at the clip length', () => {
  assert.deepEqual(expectedColorsAt(0.25), [
    hexToRgb('B8203A'),
    hexToRgb('1F9D70'),
    hexToRgb('55A4DB')
  ]);
  assert.deepEqual(expectedColorsAt(1.25), [
    hexToRgb('D94B62'),
    hexToRgb('43BD8B'),
    hexToRgb('164A7C')
  ]);
  assert.deepEqual(expectedColorsAt(2.25), expectedColorsAt(0.25));
});

test('decodeSampleStrip averages each horizontal sample block', () => {
  const pixels = Buffer.from([
    10, 20, 30, 10, 20, 30, 40, 50, 60, 40, 50, 60, 70, 80, 90, 70, 80, 90,
    10, 20, 30, 10, 20, 30, 40, 50, 60, 40, 50, 60, 70, 80, 90, 70, 80, 90
  ]);
  assert.deepEqual(decodeSampleStrip(pixels), [[10, 20, 30], [40, 50, 60], [70, 80, 90]]);
});

test('validateSampleColors accepts compression tolerance and rejects wrong slots', () => {
  assert.doesNotThrow(() => validateSampleColors([[100, 20, 30]], [[110, 25, 35]], 15));
  assert.throws(() => validateSampleColors([[20, 100, 30]], [[110, 25, 35]], 15), /does not match expected/);
});

test('validateProbeResult enforces the ClipTrio MP4 contract', () => {
  const valid = {
    streams: [
      { codec_type: 'video', codec_name: 'h264', width: 1080, height: 1920, pix_fmt: 'yuv420p', r_frame_rate: '30/1' },
      { codec_type: 'audio', codec_name: 'aac' }
    ],
    format: { duration: '4.018' }
  };
  assert.equal(validateProbeResult(valid).duration, 4.018);
  assert.throws(() => validateProbeResult({ ...valid, streams: [{ ...valid.streams[0], width: 720 }] }), /1080x1920/);
});
