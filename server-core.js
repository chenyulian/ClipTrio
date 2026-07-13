import {
  FFMPEG_CAPTION_FONT_OPACITY,
  getFfmpegCaptionMetrics,
  getFfmpegCaptionYExpression,
  getOutputGeometry,
  normalizeOutputFrameRate,
  OUTPUT_WIDTH,
} from './public/composition-core.js';

export const labels = ['top', 'middle', 'bottom'];

export const maxVideoBytes = 1024 * 1024 * 120;
export const maxUploadBytes = 1024 * 1024 * 380;
export const maxVideoSeconds = 30;
export const maxExportSeconds = 10;
export const maxClipSeconds = 8;
export const allowedVideoExtensions = new Set(['.mov', '.mp4', '.m4v']);

export class RenderRequestError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'RenderRequestError';
    this.status = status;
    this.expose = true;
  }
}

export function renderRequestError(message, status = 400) {
  return new RenderRequestError(message, status);
}

export function isAllowedVideoExtension(extension) {
  return allowedVideoExtensions.has(String(extension || '').toLowerCase());
}

export function validateVideoExtension(filename) {
  const dotIndex = String(filename || '').lastIndexOf('.');
  const extension = dotIndex >= 0 ? String(filename).slice(dotIndex).toLowerCase() : '';
  if (!isAllowedVideoExtension(extension)) {
    throw renderRequestError('Only MOV, MP4, and M4V videos are supported.');
  }
  return extension;
}

export function validateVideoSize(size, limit = maxVideoBytes) {
  if (Number(size) > limit) {
    throw renderRequestError(`Each video must be ${Math.round(limit / 1024 / 1024)}MB or smaller.`);
  }
}

export function validateRenderFiles(files) {
  const missing = labels.filter((_, index) => !files[index]);
  if (missing.length) {
    throw renderRequestError('Please upload top, middle, and bottom videos.');
  }
}

export function validateVideoDuration(file, duration) {
  if (duration > maxVideoSeconds) {
    throw renderRequestError(`Video "${file.filename}" is ${duration.toFixed(1)}s. Max duration is ${maxVideoSeconds}s.`);
  }
}

export function collectRenderParts(parts, options = {}) {
  const videoSizeLimit = options.maxVideoBytes ?? maxVideoBytes;
  const fields = {};
  const files = [];

  for (const part of parts) {
    if (part.filename) {
      const slot = labels.indexOf(part.name);
      if (slot === -1) continue;
      validateVideoSize(part.data.length, videoSizeLimit);
      const extension = validateVideoExtension(part.filename || '');
      files[slot] = {
        data: part.data,
        extension,
        filename: part.filename,
        size: part.data.length,
        slot
      };
    } else {
      fields[part.name] = part.data.toString('utf8');
    }
  }

  validateRenderFiles(files);
  return { fields, files };
}

export function getPublicRenderError(error) {
  const message = String(error?.message || '');
  const missingFfmpeg = error?.code === 'ENOENT' || /not recognized|ENOENT|no such file/i.test(message);

  if (missingFfmpeg) {
    return {
      status: 500,
      message: '当前服务找不到 FFmpeg/FFprobe，无法导出 MP4。请使用 Docker 版服务，或安装 FFmpeg 并设置 FFMPEG_PATH/FFPROBE_PATH 后重启服务。'
    };
  }

  if (error?.code === 'ETIMEDOUT') {
    return {
      status: 504,
      message: '视频处理超时，请缩短片段或稍后重试。'
    };
  }

  if (error?.expose && Number.isInteger(error.status)) {
    return { status: error.status, message };
  }

  return {
    status: 400,
    message: 'Video render failed.'
  };
}

export function buildProxyResponseHeaders(upstreamHeaders, bodyLength) {
  const headers = {
    'content-type': upstreamHeaders.get('content-type') || 'application/octet-stream',
    'content-length': bodyLength,
    'cache-control': upstreamHeaders.get('cache-control') || 'no-store'
  };
  const disposition = upstreamHeaders.get('content-disposition');
  if (disposition) headers['content-disposition'] = disposition;
  return headers;
}

export function sanitizeCaption(value) {
  return Array.from(String(value || ''))
    .filter(char => /[A-Za-z0-9\u4e00-\u9fff ]/.test(char))
    .slice(0, 18)
    .join('')
    .trim();
}

export function sanitizeNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

export function ffmpegText(value) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');
}

export function buildDrawText(caption, yExpression = getFfmpegCaptionYExpression(), fontSize = 34) {
  if (!caption) return '';
  const text = ffmpegText(caption);
  const font = '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc';
  return `drawtext=fontfile=${font}:text='${text}':fontcolor=white@${FFMPEG_CAPTION_FONT_OPACITY}:fontsize=${fontSize}:x=(w-text_w)/2:y=${yExpression}`;
}

export function normalizeRenderFields(fields = {}) {
  const exportLength = sanitizeNumber(fields.exportLength, 5, 1, maxExportSeconds);
  const clipLength = sanitizeNumber(fields.clipLength, 3, 0.3, maxClipSeconds);
  const resolution = Number(fields.resolution) === 720 ? 720 : OUTPUT_WIDTH;
  const frameRate = normalizeOutputFrameRate(fields.frameRate);
  const starts = labels.map((_, index) => sanitizeNumber(fields[`start${index}`], 0, 0, 9999));
  const captions = labels.map((_, index) => sanitizeCaption(fields[`caption${index}`]));
  const captionIndexes = captions
    .map((caption, index) => caption ? index : -1)
    .filter(index => index >= 0);

  return { exportLength, clipLength, resolution, frameRate, starts, captions, captionIndexes };
}

export function buildSegmentArgs({ start, clipLength, inputPath, outputPath }) {
  return [
    '-y',
    '-hide_banner',
    '-ss', String(start),
    '-t', String(clipLength),
    '-i', inputPath,
    '-an',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-preset', 'ultrafast',
    '-crf', '20',
    outputPath
  ];
}

export function buildFilterComplex({ exportLength, captions, captionIndexes, resolution = OUTPUT_WIDTH, frameRate = 30 }) {
  const chains = [];
  const geometry = getOutputGeometry(resolution);
  const captionMetrics = getFfmpegCaptionMetrics(resolution);
  const captionY = `h-${captionMetrics.topOffset}`;

  if (captionIndexes.length === 1) {
    chains.push(`[3:v]format=gray[m${captionIndexes[0]}]`);
  } else if (captionIndexes.length > 1) {
    chains.push(`[3:v]format=gray,split=${captionIndexes.length}${captionIndexes.map(index => `[m${index}]`).join('')}`);
  }

  labels.forEach((_, index) => {
    chains.push(`[${index}:v]trim=duration=${exportLength},setpts=PTS-STARTPTS,scale=${geometry.width}:${geometry.ffmpegSectionHeight}:force_original_aspect_ratio=increase,crop=${geometry.width}:${geometry.ffmpegSectionHeight},setsar=1,fps=${frameRate}[base${index}]`);

    if (captions[index]) {
      chains.push(`color=c=black:s=${geometry.width}x${geometry.ffmpegSectionHeight}:d=${exportLength},format=rgba[black${index}]`);
      chains.push(`[black${index}][m${index}]alphamerge[grad${index}]`);
      chains.push(`[base${index}][grad${index}]overlay=0:0,${buildDrawText(captions[index], captionY, captionMetrics.fontSize)}[v${index}]`);
    } else {
      chains.push(`[base${index}]copy[v${index}]`);
    }
  });

  return `${chains.join(';')};[v0][v1][v2]vstack=inputs=3,crop=${geometry.width}:${geometry.height},format=yuv420p[v]`;
}

export function buildFinalRenderArgs({ segmentPaths, exportLength, captions, captionIndexes, maskPath, outputPath, resolution = OUTPUT_WIDTH, frameRate = 30 }) {
  const args = ['-y', '-hide_banner'];

  segmentPaths.forEach(segmentPath => {
    args.push('-stream_loop', '-1', '-i', segmentPath);
  });

  if (captionIndexes.length) {
    args.push('-loop', '1', '-t', String(exportLength), '-i', maskPath);
  }

  args.push('-f', 'lavfi', '-t', String(exportLength), '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');
  args.push(
    '-filter_complex', buildFilterComplex({ exportLength, captions, captionIndexes, resolution, frameRate }),
    '-map', '[v]',
    '-map', `${captionIndexes.length ? 4 : 3}:a`,
    '-t', String(exportLength),
    '-c:v', 'libx264',
    '-profile:v', 'high',
    '-level', frameRate === 60 ? '5.1' : '4.1',
    '-pix_fmt', 'yuv420p',
    '-r', String(frameRate),
    '-crf', '18',
    '-preset', 'veryfast',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-movflags', '+faststart',
    outputPath
  );

  return args;
}
