// Pure helpers and constants shared between the browser app and Node tests.
// Keep this file dependency-free so it can run under `node --test` without a
// bundler. Functions here must not touch DOM, Canvas, fetch, XHR, or timers.

export const labels = ['上', '中', '下'];

export const MAX_VIDEO_MB = 120;
export const MAX_VIDEO_BYTES = MAX_VIDEO_MB * 1024 * 1024;
export const MAX_VIDEO_SECONDS = 30;
export const MAX_TOTAL_MB = 380;
export const MAX_TOTAL_BYTES = MAX_TOTAL_MB * 1024 * 1024;
export const MAX_CLIP_SECONDS = 8;
export const MAX_EXPORT_SECONDS = 10;
export const MIN_CLIP_SECONDS = 0.3;
export const MIN_EXPORT_SECONDS = 1;

export const CAPTION_MAX = 18;
export const CAPTION_RE = /[A-Za-z0-9一-鿿　-〿＀-￯ ]/u;

const MB = 1024 * 1024;

export function clamp(value, min, max) {
  if (Number.isNaN(value)) return min;
  return Math.max(min, Math.min(max, value));
}

export function sanitizeCaption(value) {
  return Array.from(String(value || ''))
    .filter(char => CAPTION_RE.test(char))
    .slice(0, CAPTION_MAX)
    .join('')
    .trim();
}

export function formatSize(bytes) {
  return `${(bytes / MB).toFixed(bytes > 10 * MB ? 0 : 1)}MB`;
}

export function formatTime(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safe / 60);
  const remaining = (safe - minutes * 60).toFixed(1).padStart(4, '0');
  return `${String(minutes).padStart(2, '0')}:${remaining}`;
}

export function formatVideoMeta(video) {
  const width = Number(video?.videoWidth) || 0;
  const height = Number(video?.videoHeight) || 0;
  return width && height ? `${width}x${height}` : '读取中';
}

export function normalizeClipLength(value) {
  return clamp(Number(value), MIN_CLIP_SECONDS, MAX_CLIP_SECONDS);
}

export function normalizeExportLength(value) {
  return clamp(Number(value), MIN_EXPORT_SECONDS, MAX_EXPORT_SECONDS);
}

export function getStart({ duration, clipLength, sliderValue }) {
  const safeDuration = Math.max(0, Number(duration) || 0);
  const safeClip = Math.max(MIN_CLIP_SECONDS, Number(clipLength) || MIN_CLIP_SECONDS);
  const maxStart = Math.max(0, safeDuration - safeClip - 0.03);
  const ratio = clamp(Number(sliderValue) / 1000, 0, 1);
  return maxStart * ratio;
}

export function getSegmentEnd({ duration, start, clipLength }) {
  const safeEnd = Math.min(Math.max(0, Number(duration) || 0), Math.max(0, Number(start) || 0) + Math.max(0, Number(clipLength) || 0));
  return safeEnd;
}

export function getSegmentWindow({ duration, start, clipLength }) {
  const safeDuration = Math.max(0, Number(duration) || 0);
  const startPos = Math.max(0, Number(start) || 0);
  const safeClip = Math.max(0, Number(clipLength) || 0);
  if (!safeDuration) {
    return { left: 0, width: 34 };
  }
  const left = clamp((startPos / safeDuration) * 100, 0, 100);
  const width = clamp((Math.min(safeClip, safeDuration) / safeDuration) * 100, 3, 100);
  return { left, width };
}

export function readyCount(slots) {
  if (!Array.isArray(slots)) return 0;
  return slots.filter(slot => slot && slot.video && Number(slot.duration) > 0).length;
}

export function isReady(slots) {
  return readyCount(slots) === 3;
}

export function totalBytes(slots) {
  if (!Array.isArray(slots)) return 0;
  return slots.reduce((sum, slot) => sum + (slot?.file?.size || 0), 0);
}

export function buildSlotMeta({ slot, index }) {
  const ready = Boolean(slot && slot.file && slot.duration);
  return {
    name: ready ? slot.file.name : '未选择',
    detail: ready
      ? `${slot.duration.toFixed(1)} 秒 · ${formatSize(slot.file.size)} · ${formatVideoMeta(slot.video)}`
      : '拖入或选择视频',
    isReady: ready,
    pickLabel: ready ? '替换' : '选择',
    label: labels[index] || ''
  };
}

export function buildLoadHint({
  ready, total, maxTotalMb = MAX_TOTAL_MB, maxVideoMb = MAX_VIDEO_MB, exportMode, exportLength
}) {
  const count = ready;
  const bytes = total;
  return {
    count: `${count} / 3`,
    topHint: `${count} / 3 素材 · ${count === 3 ? '可以预览' : '待选择'}`,
    source: `${count}/3 视频`,
    output: exportMode === 'image' ? '三拼图片 PNG' : `${exportLength} 秒 MP4`,
    outputMeta: exportMode === 'image' ? '1080 × 1920 / 当前预览帧' : '1080 × 1920 / 30fps',
    limit: bytes ? `${formatSize(bytes)} / ${maxTotalMb}MB` : `≤ ${maxVideoMb}MB`,
    multiPick: count ? '↻ 重新选择 3 个视频' : '＋ 添加 3 个视频'
  };
}

export function buildChecklistText({ ready, withinTotal, previewSeen, exportMode }) {
  return {
    duration: {
      done: ready && withinTotal,
      warn: !withinTotal,
      text: exportMode === 'image' ? '图片尺寸符合导出要求' : '时长与体积符合限制'
    },
    preview: {
      done: ready && (previewSeen || exportMode === 'image'),
      text: exportMode === 'image' ? '当前预览帧可导出' : '预览确认后可导出'
    }
  };
}

export function buildExportModeView(mode) {
  const imageMode = mode === 'image';
  return {
    isImage: imageMode,
    codecText: imageMode ? 'PNG 图片' : 'H.264 MP4',
    buttonLabel: imageMode ? '↓ 导出三拼图片' : '↓ 导出视频',
    statusText: imageMode ? '图片模式将导出当前预览画面。' : '视频模式将渲染循环片段。',
    videoActive: !imageMode,
    imageActive: imageMode,
    videoAriaPressed: !imageMode,
    imageAriaPressed: imageMode,
    hideVideoRows: imageMode
  };
}
