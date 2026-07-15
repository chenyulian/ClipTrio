import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BROWSER_VIDEO_FRAME_RATE,
  BROWSER_VIDEO_RESOLUTION,
  buildBrowserFinalArgs,
  buildBrowserSegmentArgs,
  formatDurationMs,
  formatMemoryBytes,
  getBrowserRenderProgress,
  readUsedJsHeapSize
} from '../public/browser-render-core.js';

test('browser prototype is fixed to 720p and 30fps', () => {
  assert.equal(BROWSER_VIDEO_RESOLUTION, 720);
  assert.equal(BROWSER_VIDEO_FRAME_RATE, 30);

  const args = buildBrowserSegmentArgs({
    inputPath: '/input-0/top.mov',
    outputPath: 'segment-0.mp4',
    start: 1.25,
    clipLength: 2
  });
  assert.deepEqual(args.slice(0, 9), [
    '-hide_banner', '-ss', '1.25', '-t', '2', '-i', '/input-0/top.mov', '-an', '-vf'
  ]);
  assert.match(args[9], /scale=720:428/);
  assert.match(args[9], /crop=720:428/);
  assert.deepEqual(args.slice(-3), ['-threads', '1', 'segment-0.mp4']);
});

test('final browser render loops three segments and maps the silent audio input', () => {
  const withoutCaption = buildBrowserFinalArgs({
    segmentPaths: ['a.mp4', 'b.mp4', 'c.mp4'],
    outputPath: 'out.mp4',
    exportLength: 5
  });
  assert.equal(withoutCaption.filter(value => value === '-stream_loop').length, 3);
  assert.match(withoutCaption[withoutCaption.indexOf('-filter_complex') + 1], /vstack=inputs=3,crop=720:1280,format=yuv420p/);
  assert.deepEqual(withoutCaption.slice(withoutCaption.indexOf('-map'), withoutCaption.indexOf('-map') + 4), [
    '-map', '[v]', '-map', '3:a'
  ]);
  assert.deepEqual(withoutCaption.slice(withoutCaption.indexOf('-crf'), withoutCaption.indexOf('-crf') + 4), [
    '-crf', '21', '-preset', 'superfast'
  ]);
  assert.deepEqual(withoutCaption.slice(-2), ['+faststart', 'out.mp4']);

  const withCaption = buildBrowserFinalArgs({
    segmentPaths: ['a.mp4', 'b.mp4', 'c.mp4'],
    outputPath: 'out.mp4',
    exportLength: 5,
    captionOverlayPath: 'captions.png'
  });
  assert.match(withCaption[withCaption.indexOf('-filter_complex') + 1], /\[stack\]\[3:v\]overlay/);
  assert.ok(withCaption.includes('4:a'));
});

test('progress weights three preparation stages and the final encode', () => {
  assert.equal(getBrowserRenderProgress(0, 0), 0);
  assert.equal(getBrowserRenderProgress(0, 1), 15);
  assert.equal(getBrowserRenderProgress(2, 1), 45);
  assert.equal(getBrowserRenderProgress(3, 0.5), 73);
  assert.equal(getBrowserRenderProgress(3, 1), 100);
});

test('performance metrics degrade explicitly when JS heap telemetry is unavailable', () => {
  assert.equal(readUsedJsHeapSize({ memory: { usedJSHeapSize: 64 * 1024 * 1024 } }), 64 * 1024 * 1024);
  assert.equal(readUsedJsHeapSize({}), null);
  assert.equal(formatDurationMs(9250), '9.3 秒');
  assert.equal(formatDurationMs(67500), '1 分 7.5 秒');
  assert.equal(formatMemoryBytes(128 * 1024 * 1024), '128 MB');
  assert.equal(formatMemoryBytes(null), '当前浏览器不可用');
});
