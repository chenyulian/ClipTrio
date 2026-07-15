import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CAPTION_GRADIENT_START,
  getCanvasCaptionMetrics,
  getCoverRect,
  getFfmpegCaptionYExpression,
  getOutputGeometry,
  getSectionRects,
  OUTPUT_HEIGHT,
  OUTPUT_WIDTH,
  SECTION_HEIGHT
} from '../public/composition-core.js';
import {
  configureOutputCanvas,
  drawCaption,
  drawCaptionOverlay,
  drawComposition
} from '../public/canvas-renderer.js';

function createRecordingContext() {
  const calls = [];
  const gradientStops = [];
  return {
    calls,
    gradientStops,
    save() { calls.push(['save']); },
    restore() { calls.push(['restore']); },
    beginPath() { calls.push(['beginPath']); },
    rect(...args) { calls.push(['rect', ...args]); },
    clip() { calls.push(['clip']); },
    drawImage(...args) { calls.push(['drawImage', ...args]); },
    clearRect(...args) { calls.push(['clearRect', ...args]); },
    fillRect(...args) { calls.push(['fillRect', ...args]); },
    fillText(...args) { calls.push(['fillText', ...args]); },
    createLinearGradient(...args) {
      calls.push(['createLinearGradient', ...args]);
      return { addColorStop: (...stop) => gradientStops.push(stop) };
    }
  };
}

test('composition contract is exactly three contiguous 1080x640 sections', () => {
  assert.equal(OUTPUT_WIDTH, 1080);
  assert.equal(OUTPUT_HEIGHT, 1920);
  assert.equal(SECTION_HEIGHT, 640);
  const sections = getSectionRects();
  assert.deepEqual(sections, [
    { x: 0, y: 0, width: 1080, height: 640 },
    { x: 0, y: 640, width: 1080, height: 640 },
    { x: 0, y: 1280, width: 1080, height: 640 }
  ]);
  assert.equal(sections.at(-1).y + sections.at(-1).height, OUTPUT_HEIGHT);
});

test('cover geometry centers landscape and portrait sources without gaps', () => {
  assert.deepEqual(getCoverRect(1920, 1080, getSectionRects()[0]), {
    x: -28.888888888888914,
    y: 0,
    width: 1137.7777777777778,
    height: 640
  });
  assert.deepEqual(getCoverRect(1080, 1920, getSectionRects()[1]), {
    x: 0,
    y: 0,
    width: 1080,
    height: 1920
  });
});

test('Canvas composition configures PNG dimensions and clips each source to its section', () => {
  const canvas = { width: 0, height: 0 };
  const ctx = createRecordingContext();
  const slots = getSectionRects().map((_, index) => ({
    duration: 4,
    video: { videoWidth: index === 0 ? 1920 : 1080, videoHeight: index === 0 ? 1080 : 1920 }
  }));

  drawComposition(canvas, ctx, { slots, captions: ['', '', ''], labels: ['上', '中', '下'] });

  assert.equal(canvas.width, 1080);
  assert.equal(canvas.height, 1920);
  assert.deepEqual(ctx.calls.filter(call => call[0] === 'rect'), [
    ['rect', 0, 0, 1080, 640],
    ['rect', 0, 640, 1080, 640],
    ['rect', 0, 1280, 1080, 640]
  ]);
  assert.equal(ctx.calls.filter(call => call[0] === 'drawImage').length, 3);
});

test('Canvas caption keeps the centralized baseline and gradient contract', () => {
  const ctx = createRecordingContext();
  const section = getSectionRects()[2];
  drawCaption(ctx, 'BOTTOM TEST', section);

  assert.deepEqual(getCanvasCaptionMetrics(), { fontSize: 37, baselineOffset: 48 });
  assert.equal(getFfmpegCaptionYExpression(), 'h-72');
  assert.deepEqual(ctx.calls.find(call => call[0] === 'createLinearGradient'), [
    'createLinearGradient',
    0,
    section.y + section.height * CAPTION_GRADIENT_START,
    0,
    section.y + section.height
  ]);
  assert.deepEqual(ctx.calls.find(call => call[0] === 'fillText').slice(1), [
    'BOTTOM TEST',
    OUTPUT_WIDTH / 2,
    section.y + section.height - 48
  ]);
});

test('caption overlay uses the 720 video prototype geometry without drawing source frames', () => {
  const canvas = { width: 0, height: 0 };
  const ctx = createRecordingContext();
  drawCaptionOverlay(canvas, ctx, ['TOP', '', 'BOTTOM'], 720);

  assert.deepEqual(canvas, { width: 720, height: 1280 });
  assert.deepEqual(ctx.calls[0], ['clearRect', 0, 0, 720, 1280]);
  assert.equal(ctx.calls.filter(call => call[0] === 'fillText').length, 2);
  assert.equal(ctx.calls.filter(call => call[0] === 'drawImage').length, 0);
});

test('configureOutputCanvas repairs stale backing-store dimensions before export', () => {
  const canvas = { width: 720, height: 1280 };
  configureOutputCanvas(canvas);
  assert.deepEqual(canvas, { width: 1080, height: 1920 });
});

test('720 preset keeps exact output dimensions and contiguous fractional sections', () => {
  const geometry = getOutputGeometry(720);
  const sections = getSectionRects(720);
  assert.deepEqual(geometry, {
    width: 720,
    height: 1280,
    sectionHeight: 1280 / 3,
    ffmpegSectionHeight: 428,
    scale: 2 / 3
  });
  assert.equal(sections[0].y, 0);
  assert.equal(sections[1].y, 1280 / 3);
  assert.equal(sections[2].y + sections[2].height, 1280);

  const canvas = { width: 0, height: 0 };
  configureOutputCanvas(canvas, 720);
  assert.deepEqual(canvas, { width: 720, height: 1280 });
});

test('changing resolution keeps a partially loaded composition visible', () => {
  const canvas = { width: 1080, height: 1920 };
  const ctx = createRecordingContext();
  const slots = [
    { duration: 4, video: { videoWidth: 1920, videoHeight: 1080 } },
    { duration: 0, video: null },
    { duration: 0, video: null }
  ];

  drawComposition(canvas, ctx, {
    slots,
    captions: ['', '', ''],
    labels: ['上', '中', '下'],
    resolution: 720
  });

  assert.deepEqual(canvas, { width: 720, height: 1280 });
  assert.equal(ctx.calls.filter(call => call[0] === 'drawImage').length, 1);
  assert.equal(ctx.calls.filter(call => call[0] === 'fillText').length, 2);
});
