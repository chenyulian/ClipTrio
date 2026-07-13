import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDrawText,
  buildFinalRenderArgs,
  buildSegmentArgs,
  ffmpegText,
  normalizeRenderFields,
  sanitizeCaption,
  sanitizeNumber
} from '../server-core.js';

test('sanitizeCaption keeps supported text and caps length', () => {
  assert.equal(sanitizeCaption('  上层 Caption_01!?  '), '上层 Caption01');
  assert.equal(sanitizeCaption('一二三四五六七八九十一二三四五六七八九十'), '一二三四五六七八九十一二三四五六七八');
  assert.equal(sanitizeCaption(null), '');
});

test('sanitizeNumber clamps invalid and out-of-range values', () => {
  assert.equal(sanitizeNumber('4.5', 3, 1, 8), 4.5);
  assert.equal(sanitizeNumber('99', 3, 1, 8), 8);
  assert.equal(sanitizeNumber('-2', 3, 1, 8), 1);
  assert.equal(sanitizeNumber('oops', 3, 1, 8), 3);
});

test('ffmpegText escapes drawtext-sensitive characters', () => {
  assert.equal(ffmpegText("a:b'c[d]\\e"), "a\\:b\\'c\\[d\\]\\\\e");
  assert.match(buildDrawText("上:层'字幕", 'h-72'), /text='上\\:层\\'字幕'/);
});

test('normalizeRenderFields applies defaults, limits, and caption indexes', () => {
  const fields = normalizeRenderFields({
    exportLength: '20',
    clipLength: '0.1',
    resolution: '720',
    frameRate: '60',
    start0: '1.25',
    start1: 'bad',
    start2: '-5',
    caption0: '上层',
    caption1: '!',
    caption2: '下层'
  });

  assert.equal(fields.exportLength, 10);
  assert.equal(fields.clipLength, 0.3);
  assert.equal(fields.resolution, 720);
  assert.equal(fields.frameRate, 60);
  assert.deepEqual(fields.starts, [1.25, 0, 0]);
  assert.deepEqual(fields.captions, ['上层', '', '下层']);
  assert.deepEqual(fields.captionIndexes, [0, 2]);
});

test('normalizeRenderFields rejects unsupported output settings', () => {
  const fields = normalizeRenderFields({ resolution: '2160', frameRate: '24' });
  assert.equal(fields.resolution, 1080);
  assert.equal(fields.frameRate, 30);
});

test('buildSegmentArgs keeps ffmpeg invocation as an argument array', () => {
  assert.deepEqual(buildSegmentArgs({
    start: 1,
    clipLength: 3,
    inputPath: 'input.mp4',
    outputPath: 'segment.mp4'
  }), [
    '-y',
    '-hide_banner',
    '-ss', '1',
    '-t', '3',
    '-i', 'input.mp4',
    '-an',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-preset', 'ultrafast',
    '-crf', '20',
    'segment.mp4'
  ]);
});

test('buildFinalRenderArgs maps audio input correctly without captions', () => {
  const args = buildFinalRenderArgs({
    segmentPaths: ['a.mp4', 'b.mp4', 'c.mp4'],
    exportLength: 5,
    captions: ['', '', ''],
    captionIndexes: [],
    maskPath: 'mask.pgm',
    outputPath: 'out.mp4'
  });

  assert.equal(args.filter(value => value === '-stream_loop').length, 3);
  assert.equal(args[args.indexOf('-map', args.indexOf('-map') + 1) + 1], '3:a');
  assert.equal(args.at(-1), 'out.mp4');
  assert.equal(args.includes('mask.pgm'), false);
});

test('buildFinalRenderArgs includes caption mask and drawtext filters', () => {
  const args = buildFinalRenderArgs({
    segmentPaths: ['a.mp4', 'b.mp4', 'c.mp4'],
    exportLength: 5,
    captions: ['上层', '', '下层'],
    captionIndexes: [0, 2],
    maskPath: 'mask.pgm',
    outputPath: 'out.mp4'
  });
  const filterComplex = args[args.indexOf('-filter_complex') + 1];

  assert.equal(args.includes('mask.pgm'), true);
  assert.equal(args[args.indexOf('-map', args.indexOf('-map') + 1) + 1], '4:a');
  assert.match(filterComplex, /\[3:v\]format=gray,split=2\[m0\]\[m2\]/);
  assert.match(filterComplex, /drawtext=.*text='上层'/);
  assert.match(filterComplex, /drawtext=.*text='下层'/);
  assert.match(filterComplex, /scale=1080:640/);
  assert.match(filterComplex, /crop=1080:640/);
  assert.match(filterComplex, /fps=30/);
});

test('buildFinalRenderArgs applies 720x1280 at 60fps without padded output', () => {
  const args = buildFinalRenderArgs({
    segmentPaths: ['a.mp4', 'b.mp4', 'c.mp4'],
    exportLength: 5,
    captions: ['上层', '', ''],
    captionIndexes: [0],
    maskPath: 'mask.pgm',
    outputPath: 'out.mp4',
    resolution: 720,
    frameRate: 60
  });
  const filterComplex = args[args.indexOf('-filter_complex') + 1];

  assert.match(filterComplex, /scale=720:428/);
  assert.match(filterComplex, /vstack=inputs=3,crop=720:1280/);
  assert.match(filterComplex, /fps=60/);
  assert.match(filterComplex, /fontsize=23/);
  assert.equal(args[args.indexOf('-r') + 1], '60');
  assert.equal(args[args.indexOf('-level') + 1], '5.1');
});
