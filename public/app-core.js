// Pure helpers and constants shared between the browser app and Node tests.
// Keep this file dependency-free so it can run under `node --test` without a
// bundler. Functions here must not touch DOM, Canvas, fetch, XHR, or timers.

export const labels = ['上', '中', '下'];
export const videoPositionLabels = ['上方', '中间', '下方'];
export const ALLOWED_VIDEO_EXTENSIONS = ['.mov', '.mp4', '.m4v'];

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
// Must stay byte-identical to the CAPTION_RE definition in server-core.js.
// The cross-module test test/caption-consistency.test.js enforces that
// sanitizeCaption() in both modules produces the same output for the same
// input. If you change one, change the other and update the test fixtures.
export const CAPTION_RE = /[A-Za-z0-9一-鿿 ]/u;

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

export function getMaxSegmentStart({ duration, clipLength }) {
  const safeDuration = Math.max(0, Number(duration) || 0);
  const safeClip = Math.max(MIN_CLIP_SECONDS, Number(clipLength) || MIN_CLIP_SECONDS);
  return Math.max(0, safeDuration - safeClip - 0.03);
}

export function normalizeSegmentStart({ duration, clipLength, start }) {
  return clamp(Number(start), 0, getMaxSegmentStart({ duration, clipLength }));
}

export function getSegmentStartFromEnd({ duration, clipLength, end }) {
  const safeClip = Math.max(MIN_CLIP_SECONDS, Number(clipLength) || MIN_CLIP_SECONDS);
  return normalizeSegmentStart({ duration, clipLength, start: Number(end) - safeClip });
}

export function formatPreciseSeconds(value) {
  return Math.max(0, Number(value) || 0).toFixed(2);
}

export function getStart({ duration, clipLength, sliderValue }) {
  const maxStart = getMaxSegmentStart({ duration, clipLength });
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

export function hasRenderableSlot(slots) {
  return readyCount(slots) > 0;
}

export function totalBytes(slots) {
  if (!Array.isArray(slots)) return 0;
  return slots.reduce((sum, slot) => sum + (slot?.file?.size || 0), 0);
}

export function validateVideoFile(file, index = -1) {
  const position = videoPositionLabels[index] || '';
  const label = `${position}视频`;
  if (!file) {
    return { code: 'missing', index, message: `请选择${label}。` };
  }

  const name = String(file.name || '');
  const extension = name.includes('.') ? name.slice(name.lastIndexOf('.')).toLowerCase() : '';
  if (!ALLOWED_VIDEO_EXTENSIONS.includes(extension)) {
    return { code: 'type', index, message: `${label}格式不支持，请选择 MOV、MP4 或 M4V。` };
  }

  const size = Math.max(0, Number(file.size) || 0);
  if (size > MAX_VIDEO_BYTES) {
    return {
      code: 'size',
      index,
      message: `${label}为 ${formatSize(size)}，超过单个视频 ${MAX_VIDEO_MB}MB 上限。`
    };
  }

  return null;
}

export function validateBatchSelection(files, maxTotalBytes = MAX_TOTAL_BYTES) {
  const selected = Array.from(files || []);
  if (selected.length !== 3) {
    return {
      code: 'count',
      message: `请一次选择 3 个视频，本次选择了 ${selected.length} 个，原素材未更改。`
    };
  }

  for (let index = 0; index < selected.length; index += 1) {
    const issue = validateVideoFile(selected[index], index);
    if (issue) return issue;
  }

  const total = selected.reduce((sum, file) => sum + (Number(file?.size) || 0), 0);
  if (total > maxTotalBytes) {
    const maxTotalMb = Math.round(maxTotalBytes / MB);
    return {
      code: 'total',
      message: `3 个视频合计 ${formatSize(total)}，超过总量 ${maxTotalMb}MB 上限，原素材未更改。`
    };
  }

  return null;
}

export function projectedTotalBytes(slots, index, nextFile) {
  return (Array.isArray(slots) ? slots : []).reduce((sum, slot, slotIndex) => {
    const file = slotIndex === index ? nextFile : slot?.file;
    return sum + (Number(file?.size) || 0);
  }, 0);
}

export function validateSlotReplacement(slots, index, candidate, maxTotalBytes = MAX_TOTAL_BYTES) {
  const total = projectedTotalBytes(slots, index, candidate?.file);
  if (total <= maxTotalBytes) return null;

  const maxTotalMb = Math.round(maxTotalBytes / MB);
  return {
    code: 'total',
    index,
    total,
    message: `替换后 3 个视频合计 ${formatSize(total)}，超过总量 ${maxTotalMb}MB 上限，原素材未更改。`
  };
}

export function getExportReadiness(slots, maxTotalBytes = MAX_TOTAL_BYTES) {
  const count = readyCount(slots);
  const total = totalBytes(slots);
  if (count < 3) {
    return {
      allowed: false,
      code: 'missing',
      reason: count ? `还需选择 ${3 - count} 个视频才能导出。` : '请选择上、中、下 3 个视频。',
      total
    };
  }
  if (total > maxTotalBytes) {
    const maxTotalMb = Math.round(maxTotalBytes / MB);
    return {
      allowed: false,
      code: 'total',
      reason: `素材合计 ${formatSize(total)}，超过 ${maxTotalMb}MB 上限，请替换较小的视频。`,
      total
    };
  }
  return { allowed: true, code: 'ready', reason: '', total };
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
  ready, total, maxTotalMb = MAX_TOTAL_MB, maxVideoMb = MAX_VIDEO_MB, exportMode, exportLength,
  resolution = 1080, frameRate = 30
}) {
  const count = ready;
  const bytes = total;
  return {
    count: `${count} / 3`,
    topHint: `${count} / 3 素材 · ${count === 3 ? '可以预览' : '待选择'}`,
    source: `${count}/3 视频`,
    output: exportMode === 'image' ? '三拼图片 PNG' : `${exportLength} 秒 MP4`,
    outputMeta: `${resolution} × ${resolution === 720 ? 1280 : 1920} / ${exportMode === 'image' ? '当前预览帧' : `${frameRate}fps`}`,
    limit: bytes ? `${formatSize(bytes)} / ${maxTotalMb}MB` : `≤ ${maxVideoMb}MB`,
    multiPick: count ? '↻ 重新选择 3 个视频' : '＋ 添加 3 个视频'
  };
}

export function buildChecklistText({ ready, withinTotal, previewSeen, exportMode }) {
  return {
    duration: {
      done: ready && withinTotal,
      warn: !withinTotal,
      text: !withinTotal
        ? `素材总量超过 ${MAX_TOTAL_MB}MB`
        : (exportMode === 'image' ? '图片尺寸符合导出要求' : '时长与体积符合限制')
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
