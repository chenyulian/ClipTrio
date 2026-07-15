import {
  buildChecklistText,
  buildExportModeView,
  buildLoadHint,
  buildRecentExportMeta,
  buildSlotMeta,
  clamp,
  createEmptySlot,
  formatPreciseSeconds,
  formatTime,
  getMaxSegmentStart,
  getSegmentEnd,
  getSegmentSliderState,
  getSegmentStartFromEnd,
  getSegmentWindow,
  getExportReadiness,
  hasRenderableSlot,
  isReady as isReadyCore,
  labels,
  MAX_TOTAL_BYTES,
  MAX_VIDEO_SECONDS,
  prependRecentExport,
  normalizeClipLength,
  normalizeExportLength,
  normalizeSegmentStart,
  readyCount as readyCountCore,
  removeSlotAt,
  reorderSlotState,
  sanitizeCaption,
  totalBytes as totalBytesCore,
  validateBatchSelection,
  validateSlotReplacement,
  validateVideoFile,
  videoPositionLabels
} from './app-core.js';
import {
  drawCaptionOverlay,
  drawComposition,
  drawPlaceholder as drawCanvasPlaceholder
} from './canvas-renderer.js';
import {
  BROWSER_VIDEO_FRAME_RATE,
  BROWSER_VIDEO_RESOLUTION,
  formatDurationMs,
  formatMemoryBytes,
  readUsedJsHeapSize
} from './browser-render-core.js';
import { BrowserFfmpegRenderer } from './browser-ffmpeg-renderer.js';

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const statusEl = document.getElementById('status');
const sourceFeedback = document.getElementById('sourceFeedback');
const exportBlockReason = document.getElementById('exportBlockReason');
const progressEl = document.getElementById('progress');
const progressBar = document.getElementById('progressBar');
const exportMetrics = document.getElementById('exportMetrics');
const metricDuration = document.getElementById('metricDuration');
const metricMemory = document.getElementById('metricMemory');
const cancelExportBtn = document.getElementById('cancelExport');
const factSource = document.getElementById('factSource');
const factOutput = document.getElementById('factOutput');
const factOutputMeta = document.getElementById('factOutputMeta');
const factLimit = document.getElementById('factLimit');
const loadHint = document.getElementById('loadHint');
const topLoadHint = document.getElementById('topLoadHint');
const playBtn = document.getElementById('play');
const playTime = document.getElementById('playTime');
const previewProgress = document.getElementById('previewProgress');
const previewResolutionMeta = document.getElementById('previewResolutionMeta');
const downloadBtn = document.getElementById('download');
const multiFiles = document.getElementById('multiFiles');
const multiPickButton = document.getElementById('multiPickButton');
const recentExportsSection = document.getElementById('recentExportsSection');
const recentExportsToggle = document.getElementById('recentExportsToggle');
const recentExportsPanel = document.getElementById('recentExportsPanel');
const recentExportsClose = document.getElementById('recentExportsClose');
const recentExportsEmpty = document.getElementById('recentExportsEmpty');
const recentExportsList = document.getElementById('recentExportsList');
const exportModeVideo = document.getElementById('exportModeVideo');
const exportModeImage = document.getElementById('exportModeImage');
const exportLengthRow = document.getElementById('exportLengthRow');
const frameRateRow = document.getElementById('frameRateRow');
const resolutionButtons = Array.from(document.querySelectorAll('[data-resolution]'));
const frameRateButtons = Array.from(document.querySelectorAll('[data-frame-rate]'));
const codecValue = document.getElementById('codecValue');
const wasmPrototypeNote = document.getElementById('wasmPrototypeNote');
const dropZone = document.getElementById('dropZone');
const fileInputs = ['fileA', 'fileB', 'fileC'].map(id => document.getElementById(id));
const nameEls = ['nameA', 'nameB', 'nameC'].map(id => document.getElementById(id));
const detailEls = ['detailA', 'detailB', 'detailC'].map(id => document.getElementById(id));
const slotEls = ['slotA', 'slotB', 'slotC'].map(id => document.getElementById(id));
const pickButtons = slotEls.map(slot => slot.querySelector('.pick'));
const resetButtons = slotEls.map(slot => slot.querySelector('.reset-slot'));
const startSliders = ['startA', 'startB', 'startC'].map(id => document.getElementById(id));
const startValues = ['startAValue', 'startBValue', 'startCValue'].map(id => document.getElementById(id));
const endValues = ['endAValue', 'endBValue', 'endCValue'].map(id => document.getElementById(id));
const segmentWindows = ['windowA', 'windowB', 'windowC'].map(id => document.getElementById(id));
const segmentPickers = startSliders.map(slider => slider.closest('.segment-picker'));
const clipLengthInput = document.getElementById('clipLength');
const clipLengthHint = document.getElementById('clipLengthHint');
const captionInputs = ['captionA', 'captionB', 'captionC'].map(id => document.getElementById(id));
const captionValues = ['captionAValue', 'captionBValue', 'captionCValue'].map(id => document.getElementById(id));
const captionRows = captionInputs.map(input => input.closest('.caption-row'));
const checks = {
  files: document.getElementById('checkFiles'),
  duration: document.getElementById('checkDuration'),
  preview: document.getElementById('checkPreview')
};

let slots = Array.from({ length: 3 }, createEmptySlot);
let playing = false;
let previewSeen = false;
let rafId = 0;
let exportMode = 'video';
let outputResolution = BROWSER_VIDEO_RESOLUTION;
let outputFrameRate = 30;
let processing = false;
let sourceLoading = false;
let sourceFeedbackMessage = '';
let draggedSlotIndex = -1;
let recentExports = [];
const browserFfmpegRenderer = new BrowserFfmpegRenderer();
let wasmExportActive = false;
let wasmExportCancelRequested = false;
const slotErrors = ['', '', ''];
const SLOT_REORDER_TYPE = 'application/x-cliptrio-slot';

function setStatus(text, state = 'idle') {
  statusEl.textContent = text;
  statusEl.className = `status ${state}`;
}

function setProgress(percent = 0, mode = 'hidden') {
  progressEl.classList.toggle('show', mode !== 'hidden');
  progressEl.classList.toggle('indeterminate', mode === 'indeterminate');
  progressBar.style.width = mode === 'determinate' ? `${clamp(percent, 0, 100)}%` : '';
}

function beginPerformanceMeasurement() {
  exportMetrics.hidden = false;
  metricDuration.textContent = '计量中';
  metricMemory.textContent = '计量中';
  const startedAt = performance.now();
  let peakMemoryBytes = readUsedJsHeapSize();
  const sample = () => {
    const current = readUsedJsHeapSize();
    if (current !== null) peakMemoryBytes = Math.max(peakMemoryBytes || 0, current);
  };
  const intervalId = window.setInterval(sample, 250);

  return () => {
    window.clearInterval(intervalId);
    sample();
    const elapsedMs = performance.now() - startedAt;
    metricDuration.textContent = formatDurationMs(elapsedMs);
    metricMemory.textContent = formatMemoryBytes(peakMemoryBytes);
    return { elapsedMs, peakMemoryBytes };
  };
}

async function createCaptionOverlayData() {
  const captions = captionInputs.map(input => input.value.trim());
  if (!captions.some(Boolean)) return null;
  const overlayCanvas = document.createElement('canvas');
  const overlayContext = overlayCanvas.getContext('2d');
  drawCaptionOverlay(overlayCanvas, overlayContext, captions, BROWSER_VIDEO_RESOLUTION);
  const blob = await new Promise((resolve, reject) => {
    overlayCanvas.toBlob(result => result
      ? resolve(result)
      : reject(new Error('字幕图层生成失败，请重试。')), 'image/png');
  });
  return new Uint8Array(await blob.arrayBuffer());
}

function setRecentExportsOpen(isOpen) {
  recentExportsPanel.classList.toggle('hidden', !isOpen);
  recentExportsToggle.setAttribute('aria-expanded', String(isOpen));
}

function formatRecentExportTime(timestamp) {
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function renderRecentExports() {
  recentExportsToggle.textContent = `最近导出 ${recentExports.length}`;
  recentExportsEmpty.hidden = recentExports.length > 0;
  recentExportsList.replaceChildren();

  recentExports.forEach(record => {
    const item = document.createElement('div');
    item.className = 'recent-item';
    const text = document.createElement('div');
    text.className = 'recent-item-text';
    const title = document.createElement('div');
    title.className = 'recent-item-title';
    title.textContent = `${record.mode === 'image' ? 'PNG 图片' : 'MP4 视频'} · ${formatRecentExportTime(record.createdAt)}`;
    const meta = document.createElement('div');
    meta.className = 'recent-item-meta';
    meta.textContent = record.meta;
    const download = document.createElement('a');
    download.className = 'recent-download';
    download.href = record.url;
    download.download = record.filename;
    download.textContent = '再次下载';
    text.append(title, meta);
    item.append(text, download);
    recentExportsList.append(item);
  });
}

function saveExportBlob(blob, details) {
  const createdAt = Date.now();
  const extension = details.mode === 'image' ? 'png' : 'mp4';
  const filename = `clip-trio-${createdAt}.${extension}`;
  const url = URL.createObjectURL(blob);
  const result = prependRecentExport(recentExports, {
    ...details,
    createdAt,
    filename,
    url,
    meta: [buildRecentExportMeta({ ...details, size: blob.size }), details.performanceText]
      .filter(Boolean)
      .join(' · ')
  });
  recentExports = result.records;
  result.removed.forEach(record => URL.revokeObjectURL(record.url));
  renderRecentExports();

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  return filename;
}

function setProcessing(isProcessing) {
  processing = isProcessing;
  cancelExportBtn.hidden = !(isProcessing && wasmExportActive);
  cancelExportBtn.disabled = !(isProcessing && wasmExportActive);
  syncActionAvailability();
}

function setSourceLoading(isLoading) {
  sourceLoading = isLoading;
  syncActionAvailability();
}

function getClipLength() {
  return normalizeClipLength(clipLengthInput.value);
}

function getExportLength() {
  return normalizeExportLength(document.getElementById('exportLength').value);
}

function readyCount() {
  return readyCountCore(slots);
}

function isReady() {
  return isReadyCore(slots);
}

function totalBytes() {
  return totalBytesCore(slots);
}

function exportReadiness() {
  return getExportReadiness(slots);
}

function syncSourceFeedback() {
  const readiness = exportReadiness();
  const totalMessage = readiness.code === 'total' ? readiness.reason : '';
  const message = sourceFeedbackMessage || totalMessage || '拖入 3 个文件；载入后可拖动槽位调整顺序';
  sourceFeedback.textContent = message;
  sourceFeedback.classList.toggle('error', Boolean(sourceFeedbackMessage || totalMessage));
}

function syncActionAvailability() {
  const busy = processing || sourceLoading;
  const ready = isReady();
  const readiness = exportReadiness();
  downloadBtn.disabled = busy || !readiness.allowed;
  playBtn.disabled = busy || !ready;
  previewProgress.disabled = busy || !ready;
  exportModeVideo.disabled = busy;
  exportModeImage.disabled = busy;
  resolutionButtons.forEach(button => {
    const unavailablePrototypeOption = exportMode === 'video' && Number(button.dataset.resolution) !== BROWSER_VIDEO_RESOLUTION;
    button.disabled = busy || unavailablePrototypeOption;
  });
  frameRateButtons.forEach(button => {
    const unavailablePrototypeOption = exportMode === 'video' && Number(button.dataset.frameRate) !== BROWSER_VIDEO_FRAME_RATE;
    button.disabled = busy || unavailablePrototypeOption;
  });
  multiFiles.disabled = busy;
  multiPickButton.disabled = busy;
  fileInputs.forEach(input => { input.disabled = busy; });
  pickButtons.forEach(button => { button.disabled = busy; });
  resetButtons.forEach((button, index) => {
    button.disabled = busy || !slots[index].video;
    button.setAttribute('aria-disabled', String(button.disabled));
  });
  slotEls.forEach((slot, index) => {
    const reorderable = !busy && Boolean(slots[index].video);
    slot.draggable = reorderable;
    slot.classList.toggle('reorderable', reorderable);
    slot.title = reorderable ? '拖动调整上、中、下顺序' : '';
  });
  exportBlockReason.textContent = busy
    ? (sourceLoading ? '正在验证视频，当前素材会保留到验证完成。' : '正在处理，请稍候。')
    : readiness.reason;
  exportBlockReason.classList.toggle('error', !busy && !readiness.allowed);
  syncSegmentAvailability(busy);
  syncSourceFeedback();
}

function syncSegmentAvailability(isProcessing = false) {
  const hasAnySource = readyCount() > 0;
  clipLengthInput.disabled = isProcessing || !hasAnySource;

  startSliders.forEach((slider, index) => {
    const enabled = !isProcessing && Boolean(slots[index].video && slots[index].duration);
    slider.disabled = !enabled;
    slider.setAttribute('aria-disabled', String(!enabled));
    startValues[index].disabled = !enabled;
    endValues[index].disabled = !enabled;
    segmentPickers[index].classList.toggle('is-disabled', !enabled);
  });

  captionInputs.forEach((input, index) => {
    const enabled = !isProcessing && Boolean(slots[index].video && slots[index].duration);
    input.disabled = !enabled;
    input.setAttribute('aria-disabled', String(!enabled));
    captionRows[index].classList.toggle('is-disabled', !enabled);
  });
}

function updateChecks() {
  const ready = isReady();
  const withinTotal = totalBytes() <= MAX_TOTAL_BYTES;
  const checklist = buildChecklistText({
    ready,
    withinTotal,
    previewSeen,
    exportMode
  });
  checks.files.classList.toggle('done', ready);
  checks.duration.classList.toggle('done', checklist.duration.done);
  checks.duration.classList.toggle('warn', checklist.duration.warn);
  checks.duration.querySelector('span:last-child').textContent = checklist.duration.text;
  checks.preview.classList.toggle('done', checklist.preview.done);
}

function updateLoadHint() {
  const count = readyCount();
  const bytes = totalBytes();
  const hint = buildLoadHint({
    ready: count,
    total: bytes,
    exportMode,
    exportLength: getExportLength(),
    resolution: outputResolution,
    frameRate: outputFrameRate
  });
  loadHint.textContent = hint.count;
  topLoadHint.textContent = hint.topHint;
  factSource.textContent = hint.source;
  factOutput.textContent = hint.output;
  factOutputMeta.textContent = hint.outputMeta;
  factLimit.textContent = hint.limit;

  slots.forEach((slot, index) => {
    const meta = buildSlotMeta({ slot, index });
    slotEls[index].classList.toggle('ready', meta.isReady);
    slotEls[index].classList.toggle('invalid', Boolean(slotErrors[index]));
    nameEls[index].textContent = meta.name;
    detailEls[index].textContent = slotErrors[index] || meta.detail;
    detailEls[index].title = slotErrors[index] || meta.detail;
    const pickButton = slotEls[index].querySelector('.pick');
    if (pickButton) pickButton.childNodes[0].nodeValue = meta.pickLabel;
  });

  multiPickButton.textContent = hint.multiPick;
  syncActionAvailability();
  updateChecks();
  syncSegmentWindows();
}

function selectOutputResolution(resolution) {
  outputResolution = Number(resolution) === 720 ? 720 : 1080;
  previewResolutionMeta.textContent = `${outputResolution} × ${outputResolution === 720 ? 1280 : 1920}`;
  resolutionButtons.forEach(option => {
    const active = Number(option.dataset.resolution) === outputResolution;
    option.classList.toggle('active', active);
    option.setAttribute('aria-pressed', String(active));
  });
}

function selectOutputFrameRate(frameRate) {
  outputFrameRate = Number(frameRate) === 60 ? 60 : 30;
  frameRateButtons.forEach(option => {
    const active = Number(option.dataset.frameRate) === outputFrameRate;
    option.classList.toggle('active', active);
    option.setAttribute('aria-pressed', String(active));
  });
}

function syncExportMode(mode) {
  const previousResolution = outputResolution;
  exportMode = mode === 'image' ? 'image' : 'video';
  const view = buildExportModeView(exportMode);
  if (!view.isImage) {
    selectOutputResolution(BROWSER_VIDEO_RESOLUTION);
    selectOutputFrameRate(BROWSER_VIDEO_FRAME_RATE);
  }
  exportModeVideo.classList.toggle('active', view.videoActive);
  exportModeImage.classList.toggle('active', view.imageActive);
  exportModeVideo.setAttribute('aria-pressed', String(view.videoAriaPressed));
  exportModeImage.setAttribute('aria-pressed', String(view.imageAriaPressed));
  exportLengthRow.classList.toggle('hidden', view.hideVideoRows);
  frameRateRow.classList.toggle('hidden', view.hideVideoRows);
  wasmPrototypeNote.classList.toggle('hidden', view.isImage);
  codecValue.textContent = view.codecText;
  downloadBtn.textContent = view.buttonLabel;
  const checklist = buildChecklistText({
    ready: isReady(),
    withinTotal: totalBytes() <= MAX_TOTAL_BYTES,
    previewSeen,
    exportMode
  });
  checks.duration.querySelector('span:last-child').textContent = checklist.duration.text;
  checks.preview.querySelector('span:last-child').textContent = checklist.preview.text;
  updateLoadHint();
  if (previousResolution !== outputResolution) {
    hasRenderableSlot(slots) ? drawFrame() : drawPlaceholder();
  }
  setStatus(view.statusText);
}

function getStart(index) {
  return normalizeSegmentStart({
    duration: slots[index].duration,
    clipLength: getClipLength(),
    start: Number(startSliders[index].value) / 1000
  });
}

function setSegmentStart(index, value) {
  const start = normalizeSegmentStart({
    duration: slots[index].duration,
    clipLength: getClipLength(),
    start: value
  });
  startSliders[index].value = String(Math.round(start * 1000));
  return getStart(index);
}

function applySegmentStartValues(values) {
  startSliders.forEach((slider, index) => {
    const state = getSegmentSliderState({
      duration: slots[index].duration,
      clipLength: getClipLength(),
      startMilliseconds: values[index]
    });
    slider.max = String(state.maxMilliseconds);
    slider.value = String(state.valueMilliseconds);
  });
}

function syncLabels() {
  startSliders.forEach((slider, index) => {
    const maxStart = getMaxSegmentStart({
      duration: slots[index].duration,
      clipLength: getClipLength()
    });
    const sliderState = getSegmentSliderState({
      duration: slots[index].duration,
      clipLength: getClipLength(),
      startMilliseconds: slider.value
    });
    slider.max = String(sliderState.maxMilliseconds);
    slider.value = String(sliderState.valueMilliseconds);
    const start = getStart(index);
    const end = getSegmentEnd({
      duration: slots[index].duration,
      start,
      clipLength: getClipLength()
    });
    const maxEnd = getSegmentEnd({
      duration: slots[index].duration,
      start: maxStart,
      clipLength: getClipLength()
    });
    startValues[index].max = formatPreciseSeconds(maxStart);
    endValues[index].min = formatPreciseSeconds(Math.min(slots[index].duration, getClipLength()));
    endValues[index].max = formatPreciseSeconds(maxEnd);
    startValues[index].value = formatPreciseSeconds(start);
    endValues[index].value = formatPreciseSeconds(end);
  });
  clipLengthHint.textContent = `循环 ${getClipLength().toFixed(1)}s`;
  syncSegmentWindows();
}

function syncSegmentWindows() {
  slots.forEach((slot, index) => {
    const start = getStart(index);
    const { left, width } = getSegmentWindow({
      duration: slot.duration,
      start,
      clipLength: getClipLength()
    });
    segmentWindows[index].style.left = `${left}%`;
    segmentWindows[index].style.width = `${width}%`;
  });
}

function updatePreviewProgress(offset = 0) {
  const length = getClipLength();
  const safeOffset = clamp(offset, 0, length);
  previewProgress.value = String(Math.round((safeOffset / length) * 1000));
  playTime.textContent = `${formatTime(safeOffset)} / ${formatTime(length)}`;
}

function syncCaptionCounts() {
  captionInputs.forEach((input, index) => {
    captionValues[index].textContent = `${Array.from(input.value).length}/18`;
  });
}

function drawPlaceholder() {
  drawCanvasPlaceholder(canvas, ctx, outputResolution);
}

function drawFrame() {
  drawComposition(canvas, ctx, {
    slots,
    captions: captionInputs.map(input => input.value.trim()),
    labels,
    resolution: outputResolution
  });
}

function loopSegments() {
  if (!playing) return;
  slots.forEach((slot, index) => {
    if (!slot.video) return;
    const start = getStart(index);
    const end = getSegmentEnd({ duration: slot.duration, start, clipLength: getClipLength() });
    if (slot.video.currentTime >= end || slot.video.currentTime < start) slot.video.currentTime = start;
  });
  const reference = slots.find(slot => slot.video);
  const referenceIndex = slots.indexOf(reference);
  if (reference?.video && referenceIndex >= 0) {
    updatePreviewProgress(reference.video.currentTime - getStart(referenceIndex));
  }
  drawFrame();
  rafId = requestAnimationFrame(loopSegments);
}

function seekVideo(video, time, duration) {
  return new Promise((resolve, reject) => {
    const done = () => {
      video.removeEventListener('seeked', done);
      video.removeEventListener('error', fail);
      resolve();
    };
    const fail = () => {
      video.removeEventListener('seeked', done);
      video.removeEventListener('error', fail);
      reject(new Error('视频读取失败'));
    };
    video.addEventListener('seeked', done, { once: true });
    video.addEventListener('error', fail, { once: true });
    video.currentTime = Math.min(Math.max(time, 0), Math.max(duration - 0.03, 0));
  });
}

async function resetSegments() {
  syncLabels();
  await Promise.all(slots.map((slot, index) => slot.video ? seekVideo(slot.video, getStart(index), slot.duration) : Promise.resolve()));
  syncSegmentWindows();
  updatePreviewProgress(0);
  drawFrame();
}

function pausePreview(message = '已暂停预览。') {
  playing = false;
  playBtn.textContent = '▶';
  playBtn.setAttribute('aria-label', '播放预览');
  playBtn.title = '播放预览';
  cancelAnimationFrame(rafId);
  slots.forEach(slot => { if (slot.video) slot.video.pause(); });
  setStatus(message);
}

async function startPreview() {
  if (!isReady()) {
    setStatus('先把上、中、下三个视频都选好。', 'error');
    return;
  }
  playing = true;
  previewSeen = true;
  playBtn.textContent = 'Ⅱ';
  playBtn.setAttribute('aria-label', '暂停预览');
  playBtn.title = '暂停预览';
  await resetSegments();
  await Promise.all(slots.map(slot => slot.video.play()));
  cancelAnimationFrame(rafId);
  loopSegments();
  setStatus('正在预览。', 'busy');
  updateChecks();
}

function sourceLoadError(message, slotIndex = -1) {
  const error = new Error(message);
  error.slotIndex = slotIndex;
  return error;
}

function releaseSlot(slot) {
  if (!slot) return;
  if (slot.video) {
    slot.video.pause();
    slot.video.remove();
  }
  if (slot.url) URL.revokeObjectURL(slot.url);
}

async function resetSlot(index) {
  if (sourceLoading || processing || !slots[index]?.video) return false;

  pausePreview(`正在清空${videoPositionLabels[index]}视频…`);
  const { nextSlots, removedSlot } = removeSlotAt(slots, index);
  slots = nextSlots;
  slotErrors[index] = '';
  sourceFeedbackMessage = '';
  startSliders[index].value = '0';
  captionInputs[index].value = '';
  fileInputs[index].value = '';
  previewSeen = false;
  releaseSlot(removedSlot);
  syncCaptionCounts();
  updateLoadHint();

  if (hasRenderableSlot(slots)) {
    await resetSegments().catch(() => drawFrame());
  } else {
    syncLabels();
    updatePreviewProgress(0);
    drawPlaceholder();
  }

  setStatus(`已清空${videoPositionLabels[index]}视频，其余素材和设置已保留。`);
  return true;
}

async function reorderSlots(fromIndex, toIndex) {
  if (sourceLoading
    || processing
    || fromIndex === toIndex
    || !slots[fromIndex]?.video
    || toIndex < 0
    || toIndex >= slots.length) return false;

  const wasPlaying = playing;
  const movedName = slots[fromIndex].file?.name || `${videoPositionLabels[fromIndex]}视频`;
  const previousSlots = slots;
  const previousStarts = startSliders.map(slider => slider.value);
  const previousCaptions = captionInputs.map(input => input.value);
  const previousErrors = slotErrors.slice();
  pausePreview('正在调整素材顺序…');

  const reordered = reorderSlotState({
    slots,
    starts: previousStarts,
    captions: previousCaptions,
    errors: previousErrors
  }, fromIndex, toIndex);
  slots = reordered.slots;
  const nextStarts = reordered.starts;
  const nextCaptions = reordered.captions;
  const nextErrors = reordered.errors;
  applySegmentStartValues(nextStarts);
  captionInputs.forEach((input, index) => { input.value = nextCaptions[index]; });
  slotErrors.splice(0, slotErrors.length, ...nextErrors);
  previewSeen = false;
  syncCaptionCounts();
  updateLoadHint();

  try {
    await resetSegments();
  } catch (error) {
    slots = previousSlots;
    applySegmentStartValues(previousStarts);
    captionInputs.forEach((input, index) => { input.value = previousCaptions[index]; });
    slotErrors.splice(0, slotErrors.length, ...previousErrors);
    syncCaptionCounts();
    updateLoadHint();
    await resetSegments().catch(() => drawFrame());
    await restorePlayback(wasPlaying);
    throw new Error('素材顺序调整失败，原顺序和编辑设置已保留。');
  }

  await restorePlayback(wasPlaying);
  setStatus(`已将 ${movedName} 移至${videoPositionLabels[toIndex]}，片段时间和字幕已随素材移动。`);
  return true;
}

async function prepareVideoSlot(index, file) {
  const issue = validateVideoFile(file, index);
  if (issue) throw sourceLoadError(issue.message, index);

  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  const candidate = { file, url, video, duration: 0 };
  video.src = url;
  video.muted = true;
  video.playsInline = true;
  video.preload = 'metadata';
  document.body.appendChild(video);

  try {
    await new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => finish(() => reject(sourceLoadError(
        `${videoPositionLabels[index]}视频读取超时，请换一个文件试试。`, index
      ))), 15000);
      const cleanup = () => {
        clearTimeout(timeoutId);
        video.removeEventListener('loadedmetadata', loaded);
        video.removeEventListener('error', failed);
      };
      const finish = callback => {
        cleanup();
        callback();
      };
      const loaded = () => finish(resolve);
      const failed = () => finish(() => reject(sourceLoadError(
        `${videoPositionLabels[index]}视频无法读取，请确认文件未损坏。`, index
      )));
      video.addEventListener('loadedmetadata', loaded, { once: true });
      video.addEventListener('error', failed, { once: true });
      video.load();
    });

    const duration = Number(video.duration);
    if (!Number.isFinite(duration) || duration <= 0) {
      throw sourceLoadError(`${videoPositionLabels[index]}视频时长无法识别，请换一个文件试试。`, index);
    }
    if (duration > MAX_VIDEO_SECONDS) {
      throw sourceLoadError(
        `${videoPositionLabels[index]}视频为 ${duration.toFixed(1)} 秒，超过 ${MAX_VIDEO_SECONDS} 秒上限。`,
        index
      );
    }

    candidate.duration = duration;
    video.preload = 'auto';
    return candidate;
  } catch (error) {
    releaseSlot(candidate);
    throw error;
  }
}

async function restorePlayback(wasPlaying) {
  if (!wasPlaying || !isReady()) return;
  try {
    await startPreview();
  } catch {
    playing = false;
  }
}

async function loadFileIntoSlot(index, file) {
  if (!file || sourceLoading || processing) return false;
  const issue = validateVideoFile(file, index);
  if (issue) {
    slotErrors[index] = issue.message;
    sourceFeedbackMessage = '替换未执行，原素材和编辑设置均已保留。';
    updateLoadHint();
    setStatus(issue.message, 'error');
    return false;
  }

  const wasPlaying = playing;
  pausePreview('正在验证视频，原素材会暂时保留...');
  setSourceLoading(true);
  let candidate = null;
  let succeeded = false;
  let finalMessage = '';
  let finalState = 'idle';

  try {
    candidate = await prepareVideoSlot(index, file);
    const previousSlots = slots;
    const nextSlots = slots.slice();
    nextSlots[index] = candidate;
    const replacementIssue = validateSlotReplacement(slots, index, candidate);
    if (replacementIssue) {
      throw sourceLoadError(replacementIssue.message, index);
    }

    slots = nextSlots;
    try {
      await resetSegments();
    } catch (error) {
      slots = previousSlots;
      await resetSegments().catch(() => {});
      throw sourceLoadError(`${videoPositionLabels[index]}视频无法定位片段，原素材未更改。`, index);
    }

    releaseSlot(previousSlots[index]);
    candidate = null;
    slotErrors[index] = '';
    sourceFeedbackMessage = '';
    previewSeen = false;
    updateLoadHint();
    succeeded = true;
    finalMessage = `已载入${videoPositionLabels[index]}视频。`;
  } catch (error) {
    if (candidate) releaseSlot(candidate);
    const slotIndex = Number.isInteger(error.slotIndex) ? error.slotIndex : index;
    slotErrors[slotIndex] = error.message || '视频读取失败，请重试。';
    sourceFeedbackMessage = '替换失败，原素材和编辑设置均已保留。';
    updateLoadHint();
    finalMessage = slotErrors[slotIndex];
    finalState = 'error';
  } finally {
    setSourceLoading(false);
    await restorePlayback(wasPlaying);
    setStatus(finalMessage, finalState);
  }

  return succeeded;
}

async function loadMultiple(files) {
  if (sourceLoading || processing) return false;
  const selected = Array.from(files || []);
  selected.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  const issue = validateBatchSelection(selected);
  if (issue) {
    if (Number.isInteger(issue.index) && issue.index >= 0) slotErrors[issue.index] = issue.message;
    sourceFeedbackMessage = issue.message;
    updateLoadHint();
    setStatus(issue.message, 'error');
    return false;
  }

  const wasPlaying = playing;
  pausePreview('正在验证 3 个视频，当前素材会暂时保留...');
  setSourceLoading(true);
  let candidates = [];
  let succeeded = false;
  let finalMessage = '';
  let finalState = 'idle';

  try {
    const results = await Promise.allSettled(selected.map((file, index) => prepareVideoSlot(index, file)));
    candidates = results.filter(result => result.status === 'fulfilled').map(result => result.value);
    const failed = results.find(result => result.status === 'rejected');
    if (failed) {
      candidates.forEach(releaseSlot);
      candidates = [];
      throw failed.reason;
    }

    const previousSlots = slots;
    slots = candidates;
    try {
      await resetSegments();
    } catch {
      slots = previousSlots;
      await resetSegments().catch(() => {});
      throw sourceLoadError('新视频无法定位片段，原有 3 个素材未更改。');
    }

    previousSlots.forEach(releaseSlot);
    candidates = [];
    slotErrors.fill('');
    sourceFeedbackMessage = '';
    previewSeen = false;
    updateLoadHint();
    succeeded = true;
    finalMessage = '三个视频已验证，并按文件名顺序放入上、中、下。';
  } catch (error) {
    candidates.forEach(releaseSlot);
    const slotIndex = Number.isInteger(error.slotIndex) ? error.slotIndex : -1;
    if (slotIndex >= 0) slotErrors[slotIndex] = error.message;
    sourceFeedbackMessage = `未替换任何素材：${error.message || '视频读取失败，请重试。'}`;
    updateLoadHint();
    finalMessage = sourceFeedbackMessage;
    finalState = 'error';
  } finally {
    setSourceLoading(false);
    await restorePlayback(wasPlaying);
    setStatus(finalMessage, finalState);
  }

  return succeeded;
}

async function exportMp4() {
  const readiness = exportReadiness();
  if (!readiness.allowed) {
    setStatus(readiness.reason, 'error');
    syncActionAvailability();
    return;
  }
  const wasPlaying = playing;
  let exportSucceeded = false;
  let finishMeasurement = null;
  let metrics = null;
  wasmExportActive = true;
  wasmExportCancelRequested = false;
  pausePreview('正在启动浏览器本地编码…');
  setProcessing(true);
  setProgress(0, 'indeterminate');
  finishMeasurement = beginPerformanceMeasurement();

  try {
    const captionOverlay = await createCaptionOverlayData();
    if (wasmExportCancelRequested) throw new DOMException('用户取消了浏览器导出。', 'AbortError');
    const result = await browserFfmpegRenderer.render({
      files: slots.map(slot => slot.file),
      starts: slots.map((_, index) => getStart(index)),
      clipLength: getClipLength(),
      exportLength: getExportLength(),
      captionOverlay,
      onProgress: percent => setProgress(percent, 'determinate'),
      onStage: message => {
        setStatus(message, 'busy');
        if (message.includes('加载')) setProgress(0, 'indeterminate');
      }
    });
    metrics = finishMeasurement();
    finishMeasurement = null;

    saveExportBlob(result.blob, {
      mode: 'video',
      resolution: BROWSER_VIDEO_RESOLUTION,
      frameRate: BROWSER_VIDEO_FRAME_RATE,
      exportLength: getExportLength(),
      performanceText: `${formatDurationMs(metrics.elapsedMs)} · JS 堆峰值 ${formatMemoryBytes(metrics.peakMemoryBytes)}`
    });
    exportSucceeded = true;
    setStatus('浏览器 MP4 导出完成，视频未上传，已加入最近导出。', 'success');
    setProgress(100, 'determinate');
  } catch (error) {
    metrics ||= finishMeasurement?.();
    finishMeasurement = null;
    setStatus(error?.name === 'AbortError'
      ? '已取消浏览器导出，素材和设置均已保留。'
      : (error.message || '浏览器导出失败。'), 'error');
    setProgress(0, 'hidden');
  } finally {
    if (finishMeasurement) finishMeasurement();
    wasmExportActive = false;
    wasmExportCancelRequested = false;
    setProcessing(false);
    if (wasPlaying && exportSucceeded) startPreview();
  }
}

async function exportPng() {
  const readiness = exportReadiness();
  if (!readiness.allowed) {
    setStatus(readiness.reason, 'error');
    syncActionAvailability();
    return;
  }
  if (playing) pausePreview('正在生成三拼图片...');
  drawFrame();
  setProcessing(true);
  const outputHeight = outputResolution === 720 ? 1280 : 1920;
  setStatus(`正在生成 ${outputResolution} × ${outputHeight} 三拼图片...`, 'busy');
  try {
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(result => result ? resolve(result) : reject(new Error('图片生成失败，请重试。')), 'image/png');
    });
    saveExportBlob(blob, {
      mode: 'image',
      resolution: outputResolution,
      frameRate: outputFrameRate,
      exportLength: getExportLength()
    });
    previewSeen = true;
    updateChecks();
    setStatus('三拼图片导出完成，已加入最近导出。', 'success');
  } catch (error) {
    setStatus(error.message || '图片导出失败。', 'error');
  } finally {
    setProcessing(false);
  }
}

recentExportsToggle.addEventListener('click', () => {
  setRecentExportsOpen(recentExportsPanel.classList.contains('hidden'));
});
recentExportsClose.addEventListener('click', () => {
  setRecentExportsOpen(false);
  recentExportsToggle.focus();
});
document.addEventListener('click', event => {
  if (!recentExportsPanel.classList.contains('hidden') && !recentExportsSection.contains(event.target)) {
    setRecentExportsOpen(false);
  }
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !recentExportsPanel.classList.contains('hidden')) {
    setRecentExportsOpen(false);
    recentExportsToggle.focus();
  }
});
window.addEventListener('beforeunload', () => {
  recentExports.forEach(record => URL.revokeObjectURL(record.url));
});

multiFiles.addEventListener('change', event => {
  const files = Array.from(event.target.files || []);
  event.target.value = '';
  loadMultiple(files).catch(error => setStatus(error.message, 'error'));
});
multiPickButton.addEventListener('click', () => multiFiles.click());
fileInputs.forEach((input, index) => input.addEventListener('change', event => {
  const file = event.target.files?.[0];
  event.target.value = '';
  loadFileIntoSlot(index, file).catch(error => setStatus(error.message, 'error'));
}));
resetButtons.forEach((button, index) => button.addEventListener('click', () => {
  resetSlot(index).catch(error => setStatus(error.message || '清空视频失败，请重试。', 'error'));
}));
startSliders.forEach(slider => slider.addEventListener('input', () => {
  previewSeen = false;
  syncLabels();
  resetSegments().catch(() => {});
  updateChecks();
}));
function commitPreciseSegmentTime(index, anchor) {
  const input = anchor === 'end' ? endValues[index] : startValues[index];
  const value = Number(input.value);
  if (!Number.isFinite(value)) {
    syncLabels();
    return;
  }
  const start = anchor === 'end'
    ? getSegmentStartFromEnd({
      duration: slots[index].duration,
      clipLength: getClipLength(),
      end: value
    })
    : value;
  const committedStart = setSegmentStart(index, start);
  previewSeen = false;
  syncLabels();
  resetSegments().catch(() => drawFrame());
  updateChecks();
  setStatus(`${videoPositionLabels[index]}片段起点已设为 ${formatPreciseSeconds(committedStart)}s。`);
}

startValues.forEach((input, index) => {
  input.addEventListener('change', () => commitPreciseSegmentTime(index, 'start'));
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') input.blur();
  });
});
endValues.forEach((input, index) => {
  input.addEventListener('change', () => commitPreciseSegmentTime(index, 'end'));
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') input.blur();
  });
});
captionInputs.forEach(input => input.addEventListener('input', () => {
  const cleaned = sanitizeCaption(input.value);
  if (input.value !== cleaned) input.value = cleaned;
  previewSeen = false;
  syncCaptionCounts();
  drawFrame();
  updateChecks();
}));
clipLengthInput.addEventListener('input', () => {
  previewSeen = false;
  syncLabels();
  updateLoadHint();
  resetSegments().catch(() => drawFrame());
});
document.getElementById('exportLength').addEventListener('input', () => {
  previewSeen = false;
  updateLoadHint();
});
playBtn.addEventListener('click', () => playing ? pausePreview() : startPreview().catch(error => setStatus(error.message, 'error')));
previewProgress.addEventListener('input', async () => {
  if (!isReady()) return;
  const wasPlaying = playing;
  if (wasPlaying) pausePreview('正在定位预览...');
  const offset = getClipLength() * (Number(previewProgress.value) / 1000);
  await Promise.all(slots.map((slot, index) => slot.video
    ? seekVideo(slot.video, getStart(index) + offset, slot.duration)
    : Promise.resolve()));
  updatePreviewProgress(offset);
  drawFrame();
  previewSeen = true;
  updateChecks();
  setStatus('已定位预览片段。');
  if (wasPlaying) {
    playing = true;
    playBtn.textContent = 'Ⅱ';
    playBtn.setAttribute('aria-label', '暂停预览');
    playBtn.title = '暂停预览';
    Promise.all(slots.map(slot => slot.video.play()))
      .then(() => loopSegments())
      .catch(error => setStatus(error.message, 'error'));
  }
});
exportModeVideo.addEventListener('click', () => syncExportMode('video'));
exportModeImage.addEventListener('click', () => syncExportMode('image'));
resolutionButtons.forEach(button => button.addEventListener('click', () => {
  if (button.disabled) return;
  selectOutputResolution(button.dataset.resolution);
  previewSeen = false;
  hasRenderableSlot(slots) ? drawFrame() : drawPlaceholder();
  updateLoadHint();
  setStatus(`导出分辨率已设为 ${outputResolution} × ${outputResolution === 720 ? 1280 : 1920}。`);
}));
frameRateButtons.forEach(button => button.addEventListener('click', () => {
  if (button.disabled) return;
  selectOutputFrameRate(button.dataset.frameRate);
  previewSeen = false;
  updateLoadHint();
  setStatus(`视频导出帧率已设为 ${outputFrameRate}fps。`);
}));
downloadBtn.addEventListener('click', () => exportMode === 'image' ? exportPng() : exportMp4());
cancelExportBtn.addEventListener('click', () => {
  if (!wasmExportActive) return;
  wasmExportCancelRequested = true;
  cancelExportBtn.disabled = true;
  setStatus('正在取消浏览器导出…', 'busy');
  browserFfmpegRenderer.cancel();
});

function setDragState(element, isDragging) {
  element.classList.toggle('dragging', isDragging);
}

function isSlotReorder(event) {
  return draggedSlotIndex >= 0 || Array.from(event.dataTransfer?.types || []).includes(SLOT_REORDER_TYPE);
}

function clearSlotDragState() {
  slotEls.forEach(slot => {
    slot.classList.remove('dragging', 'reordering', 'reorder-target');
    slot.setAttribute('aria-grabbed', 'false');
  });
}

slotEls.forEach((slotEl, index) => {
  slotEl.addEventListener('dragstart', event => {
    if (!slotEl.draggable || event.target.closest('button, input')) {
      event.preventDefault();
      return;
    }
    draggedSlotIndex = index;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(SLOT_REORDER_TYPE, String(index));
    slotEl.classList.add('reordering');
    slotEl.setAttribute('aria-grabbed', 'true');
  });
  slotEl.addEventListener('dragend', () => {
    draggedSlotIndex = -1;
    clearSlotDragState();
  });
});

['dragenter', 'dragover'].forEach(eventName => {
  dropZone.addEventListener(eventName, event => {
    event.preventDefault();
    if (!isSlotReorder(event)) setDragState(dropZone, true);
  });
  slotEls.forEach(slotEl => slotEl.addEventListener(eventName, event => {
    event.preventDefault();
    event.stopPropagation();
    if (isSlotReorder(event)) {
      event.dataTransfer.dropEffect = 'move';
      slotEl.classList.toggle('reorder-target', Number(slotEl.dataset.slot) !== draggedSlotIndex);
    } else {
      setDragState(slotEl, true);
    }
  }));
});
['dragleave', 'drop'].forEach(eventName => {
  dropZone.addEventListener(eventName, event => {
    event.preventDefault();
    setDragState(dropZone, false);
  });
  slotEls.forEach(slotEl => slotEl.addEventListener(eventName, event => {
    if (eventName === 'dragleave' && event.relatedTarget && slotEl.contains(event.relatedTarget)) return;
    event.preventDefault();
    event.stopPropagation();
    slotEl.classList.remove('dragging', 'reorder-target');
  }));
});
dropZone.addEventListener('drop', event => {
  if (!isSlotReorder(event) && !sourceLoading && !processing && event.dataTransfer?.files?.length) {
    loadMultiple(event.dataTransfer.files).catch(error => setStatus(error.message, 'error'));
  }
});
slotEls.forEach((slotEl, index) => {
  slotEl.addEventListener('drop', event => {
    if (isSlotReorder(event)) {
      const transferredIndex = event.dataTransfer?.getData(SLOT_REORDER_TYPE);
      const fromIndex = transferredIndex === '' || transferredIndex == null
        ? draggedSlotIndex
        : Number(transferredIndex);
      draggedSlotIndex = -1;
      clearSlotDragState();
      reorderSlots(fromIndex, index).catch(error => setStatus(error.message, 'error'));
      return;
    }
    const file = event.dataTransfer?.files?.[0];
    if (!sourceLoading && !processing && file) {
      loadFileIntoSlot(index, file).catch(error => setStatus(error.message, 'error'));
    }
  });
});

renderRecentExports();
syncLabels();
syncCaptionCounts();
syncExportMode('video');
updatePreviewProgress(0);
drawPlaceholder();
