import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALLOWED_VIDEO_EXTENSIONS,
  buildChecklistText,
  buildExportModeView,
  buildLoadHint,
  buildSlotMeta,
  CAPTION_MAX,
  CAPTION_RE,
  clamp,
  formatSize,
  formatTime,
  formatVideoMeta,
  getSegmentEnd,
  getSegmentWindow,
  getStart,
  getExportReadiness,
  isReady,
  labels,
  MAX_EXPORT_SECONDS,
  MAX_TOTAL_BYTES,
  MAX_TOTAL_MB,
  MAX_VIDEO_BYTES,
  MAX_VIDEO_MB,
  MAX_VIDEO_SECONDS,
  normalizeClipLength,
  normalizeExportLength,
  projectedTotalBytes,
  readyCount,
  sanitizeCaption,
  totalBytes,
  validateBatchSelection,
  validateSlotReplacement,
  validateVideoFile,
  videoPositionLabels
} from '../public/app-core.js';

test('clamp honors NaN, min, and max', () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-1, 0, 10), 0);
  assert.equal(clamp(99, 0, 10), 10);
  assert.equal(clamp(Number.NaN, 3, 7), 3);
});

test('sanitizeCaption matches server-core behavior and trims', () => {
  assert.equal(sanitizeCaption('  上层 Caption_01!?  '), '上层 Caption01');
  const long = '一二三四五六七八九十一二三四五六七八九十';
  assert.equal(sanitizeCaption(long), long.slice(0, CAPTION_MAX));
  assert.equal(sanitizeCaption(null), '');
  assert.equal(sanitizeCaption('   '), '');
  // Regex character class covers ASCII letters/digits, the basic CJK block,
  // and a space — matching server-core's sanitization range.
  assert.match('上', CAPTION_RE);
  assert.match('A', CAPTION_RE);
  assert.match('0', CAPTION_RE);
  assert.match(' ', CAPTION_RE);
  assert.doesNotMatch('!', CAPTION_RE);
  assert.doesNotMatch('한', CAPTION_RE); // Hangul outside the CJK basic block
});

test('formatSize toggles decimal precision at the 10MB boundary', () => {
  assert.equal(formatSize(5 * 1024 * 1024), '5.0MB');
  // Boundary: bytes > 10MB is false, so the 10MB case keeps one decimal.
  assert.equal(formatSize(10 * 1024 * 1024), '10.0MB');
  assert.equal(formatSize(11 * 1024 * 1024), '11MB');
  assert.equal(formatSize(99 * 1024 * 1024), '99MB');
});

test('formatTime pads minutes and one-decimal seconds', () => {
  assert.equal(formatTime(0), '00:00.0');
  assert.equal(formatTime(1.2), '00:01.2');
  assert.equal(formatTime(65.06), '01:05.1');
  assert.equal(formatTime(-3), '00:00.0');
  assert.equal(formatTime(Number.NaN), '00:00.0');
});

test('formatVideoMeta returns resolution or 读取中', () => {
  assert.equal(formatVideoMeta({ videoWidth: 1080, videoHeight: 1920 }), '1080x1920');
  assert.equal(formatVideoMeta({ videoWidth: 0, videoHeight: 0 }), '读取中');
  assert.equal(formatVideoMeta({}), '读取中');
  assert.equal(formatVideoMeta(null), '读取中');
});

test('normalizeClipLength and normalizeExportLength clamp to constants', () => {
  assert.equal(normalizeClipLength('0.1'), 0.3);
  assert.equal(normalizeClipLength('3.5'), 3.5);
  assert.equal(normalizeClipLength('99'), 8);
  assert.equal(normalizeExportLength('0.1'), 1);
  assert.equal(normalizeExportLength('5'), 5);
  assert.equal(normalizeExportLength('99'), MAX_EXPORT_SECONDS);
  assert.equal(MAX_VIDEO_SECONDS, 30);
  assert.equal(MAX_TOTAL_MB, 380);
  assert.equal(MAX_VIDEO_MB, 120);
  assert.equal(MAX_TOTAL_BYTES, MAX_TOTAL_MB * 1024 * 1024);
});

test('getStart returns 0 when slider is 0 and clips to max start', () => {
  assert.equal(getStart({ duration: 10, clipLength: 3, sliderValue: 0 }), 0);
  assert.equal(getStart({ duration: 10, clipLength: 3, sliderValue: 1000 }), 10 - 3 - 0.03);
  assert.equal(getStart({ duration: 0, clipLength: 3, sliderValue: 800 }), 0);
  // slider out of range clamps to ratio
  assert.equal(getStart({ duration: 10, clipLength: 3, sliderValue: -200 }), 0);
  assert.equal(getStart({ duration: 10, clipLength: 3, sliderValue: 1500 }), 10 - 3 - 0.03);
});

test('getSegmentEnd is min(duration, start+clipLength), clamping negative starts to 0', () => {
  assert.equal(getSegmentEnd({ duration: 10, start: 4, clipLength: 3 }), 7);
  assert.equal(getSegmentEnd({ duration: 5, start: 4, clipLength: 3 }), 5);
  // Negative starts are clamped to 0 so the end is just clipLength.
  assert.equal(getSegmentEnd({ duration: 10, start: -2, clipLength: 3 }), 3);
});

test('getSegmentWindow computes left and width percentages, with 34% default when empty', () => {
  assert.deepEqual(getSegmentWindow({ duration: 0, start: 0, clipLength: 3 }), { left: 0, width: 34 });
  const full = getSegmentWindow({ duration: 10, start: 2, clipLength: 4 });
  assert.equal(full.left, 20);
  assert.equal(full.width, 40);
  // Width is at least 3%.
  const tiny = getSegmentWindow({ duration: 100, start: 0, clipLength: 0.01 });
  assert.equal(tiny.width, 3);
});

test('readyCount / isReady / totalBytes operate on slot array', () => {
  const empty = Array.from({ length: 3 }, () => ({ file: null, url: '', video: null, duration: 0 }));
  assert.equal(readyCount(empty), 0);
  assert.equal(isReady(empty), false);
  assert.equal(totalBytes(empty), 0);

  const one = empty.map((s, i) => i === 0
    ? { file: { name: 'a.mp4', size: 1024 * 1024 }, url: 'blob:', video: { duration: 5 }, duration: 5 }
    : s);
  assert.equal(readyCount(one), 1);
  assert.equal(isReady(one), false);
  assert.equal(totalBytes(one), 1024 * 1024);

  const all = one.map((s, i) => i > 0
    ? { file: { name: `${i}.mp4`, size: 2 * 1024 * 1024 }, url: 'blob:', video: { duration: 4 }, duration: 4 }
    : s);
  assert.equal(readyCount(all), 3);
  assert.equal(isReady(all), true);
  assert.equal(totalBytes(all), 5 * 1024 * 1024);
});

test('validateVideoFile aligns browser selection with the renderer contract', () => {
  assert.deepEqual(ALLOWED_VIDEO_EXTENSIONS, ['.mov', '.mp4', '.m4v']);
  assert.deepEqual(videoPositionLabels, ['上方', '中间', '下方']);
  assert.equal(validateVideoFile({ name: 'clip.MOV', size: 1024 }, 1), null);

  const typeIssue = validateVideoFile({ name: 'clip.webm', size: 1024, type: 'video/webm' }, 1);
  assert.equal(typeIssue.code, 'type');
  assert.equal(typeIssue.index, 1);
  assert.match(typeIssue.message, /中间视频格式不支持/);

  const sizeIssue = validateVideoFile({ name: 'clip.mp4', size: MAX_VIDEO_BYTES + 1 }, 2);
  assert.equal(sizeIssue.code, 'size');
  assert.equal(sizeIssue.index, 2);
  assert.match(sizeIssue.message, /下方视频/);
});

test('validateBatchSelection rejects the whole selection before replacement', () => {
  const valid = ['01.mp4', '02.mov', '03.m4v'].map(name => ({ name, size: 2 * 1024 * 1024 }));
  assert.equal(validateBatchSelection(valid), null);

  const countIssue = validateBatchSelection(valid.slice(0, 2));
  assert.equal(countIssue.code, 'count');
  assert.match(countIssue.message, /原素材未更改/);

  const typeIssue = validateBatchSelection([valid[0], { name: '02.webm', size: 1024 }, valid[2]]);
  assert.equal(typeIssue.code, 'type');
  assert.equal(typeIssue.index, 1);

  const totalIssue = validateBatchSelection(valid, 5 * 1024 * 1024);
  assert.equal(totalIssue.code, 'total');
  assert.match(totalIssue.message, /超过总量 5MB/);
});

test('projectedTotalBytes and getExportReadiness guard single-slot replacements', () => {
  const slots = [1, 2, 3].map(size => ({
    file: { name: `${size}.mp4`, size: size * 1024 * 1024 },
    video: { duration: 5 },
    duration: 5
  }));
  assert.equal(projectedTotalBytes(slots, 1, { size: 8 * 1024 * 1024 }), 12 * 1024 * 1024);

  const ready = getExportReadiness(slots);
  assert.equal(ready.allowed, true);
  assert.equal(ready.code, 'ready');

  const oversized = getExportReadiness(slots, 5 * 1024 * 1024);
  assert.equal(oversized.allowed, false);
  assert.equal(oversized.code, 'total');
  assert.match(oversized.reason, /替换较小的视频/);

  const partial = getExportReadiness(slots.slice(0, 2));
  assert.equal(partial.allowed, false);
  assert.equal(partial.code, 'missing');
  assert.match(partial.reason, /还需选择 1 个视频/);
});

test('validateSlotReplacement rejects before replacing an existing slot', () => {
  const slots = [1, 2, 3].map(size => ({
    file: { name: `${size}.mp4`, size: size * 1024 * 1024 },
    video: { duration: 5 },
    duration: 5
  }));
  const candidate = {
    file: { name: 'replacement.mp4', size: 8 * 1024 * 1024 },
    video: { duration: 5 },
    duration: 5
  };

  assert.equal(validateSlotReplacement(slots, 1, candidate, 12 * 1024 * 1024), null);

  const issue = validateSlotReplacement(slots, 1, candidate, 11 * 1024 * 1024);
  assert.equal(issue.code, 'total');
  assert.equal(issue.index, 1);
  assert.equal(issue.total, 12 * 1024 * 1024);
  assert.match(issue.message, /原素材未更改/);
});

test('buildSlotMeta mirrors the previous inline format', () => {
  const empty = buildSlotMeta({ slot: { file: null, video: null, duration: 0 }, index: 0 });
  assert.equal(empty.name, '未选择');
  assert.equal(empty.detail, '拖入或选择视频');
  assert.equal(empty.isReady, false);
  assert.equal(empty.pickLabel, '选择');

  const ready = buildSlotMeta({
    slot: {
      file: { name: 'top.mov', size: 5 * 1024 * 1024 },
      video: { videoWidth: 1080, videoHeight: 1920 },
      duration: 6.4
    },
    index: 0
  });
  assert.equal(ready.name, 'top.mov');
  assert.equal(ready.detail, '6.4 秒 · 5.0MB · 1080x1920');
  assert.equal(ready.isReady, true);
  assert.equal(ready.pickLabel, '替换');
});

test('buildLoadHint reflects ready count, totals, and export mode', () => {
  const video = buildLoadHint({ ready: 2, total: 0, exportMode: 'video', exportLength: 5 });
  assert.equal(video.count, '2 / 3');
  assert.equal(video.topHint, '2 / 3 素材 · 待选择');
  assert.equal(video.output, '5 秒 MP4');
  assert.equal(video.outputMeta, '1080 × 1920 / 30fps');
  assert.equal(video.limit, `≤ ${MAX_VIDEO_MB}MB`);

  const image = buildLoadHint({ ready: 3, total: 200 * 1024 * 1024, exportMode: 'image', exportLength: 5 });
  assert.equal(image.count, '3 / 3');
  assert.equal(image.topHint, '3 / 3 素材 · 可以预览');
  assert.equal(image.output, '三拼图片 PNG');
  assert.equal(image.outputMeta, '1080 × 1920 / 当前预览帧');
  assert.equal(image.limit, `${formatSize(200 * 1024 * 1024)} / ${MAX_TOTAL_MB}MB`);
  assert.equal(image.multiPick, '↻ 重新选择 3 个视频');
});

test('buildChecklistText maps mode to text and flags', () => {
  const readyVideo = buildChecklistText({ ready: true, withinTotal: true, previewSeen: false, exportMode: 'video' });
  assert.equal(readyVideo.duration.done, true);
  assert.equal(readyVideo.duration.warn, false);
  assert.equal(readyVideo.duration.text, '时长与体积符合限制');
  assert.equal(readyVideo.preview.done, false);
  assert.equal(readyVideo.preview.text, '预览确认后可导出');

  const oversize = buildChecklistText({ ready: true, withinTotal: false, previewSeen: true, exportMode: 'video' });
  assert.equal(oversize.duration.done, false);
  assert.equal(oversize.duration.warn, true);
  assert.equal(oversize.duration.text, `素材总量超过 ${MAX_TOTAL_MB}MB`);

  const image = buildChecklistText({ ready: true, withinTotal: true, previewSeen: false, exportMode: 'image' });
  assert.equal(image.preview.done, true); // image mode is always exportable
  assert.equal(image.duration.text, '图片尺寸符合导出要求');
  assert.equal(image.preview.text, '当前预览帧可导出');
});

test('buildExportModeView toggles every surface used by syncExportMode', () => {
  const video = buildExportModeView('video');
  assert.equal(video.isImage, false);
  assert.equal(video.codecText, 'H.264 MP4');
  assert.equal(video.buttonLabel, '↓ 导出视频');
  assert.equal(video.statusText, '视频模式将渲染循环片段。');
  assert.equal(video.videoActive, true);
  assert.equal(video.imageActive, false);
  assert.equal(video.videoAriaPressed, true);
  assert.equal(video.imageAriaPressed, false);
  assert.equal(video.hideVideoRows, false);

  const image = buildExportModeView('image');
  assert.equal(image.isImage, true);
  assert.equal(image.codecText, 'PNG 图片');
  assert.equal(image.buttonLabel, '↓ 导出三拼图片');
  assert.equal(image.statusText, '图片模式将导出当前预览画面。');
  assert.equal(image.videoActive, false);
  assert.equal(image.imageActive, true);
  assert.equal(image.hideVideoRows, true);
});

test('labels array is the same shape the UI used', () => {
  assert.deepEqual(labels, ['上', '中', '下']);
});
