export const labels = ['top', 'middle', 'bottom'];

export const maxVideoBytes = 1024 * 1024 * 120;
export const maxUploadBytes = 1024 * 1024 * 380;
export const maxVideoSeconds = 30;
export const maxExportSeconds = 10;
export const maxClipSeconds = 8;

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

export function buildDrawText(caption, yExpression) {
  if (!caption) return '';
  const text = ffmpegText(caption);
  const font = '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc';
  return `drawtext=fontfile=${font}:text='${text}':fontcolor=white@0.92:fontsize=34:x=(w-text_w)/2:y=${yExpression}`;
}

export function normalizeRenderFields(fields = {}) {
  const exportLength = sanitizeNumber(fields.exportLength, 5, 1, maxExportSeconds);
  const clipLength = sanitizeNumber(fields.clipLength, 3, 0.3, maxClipSeconds);
  const starts = labels.map((_, index) => sanitizeNumber(fields[`start${index}`], 0, 0, 9999));
  const captions = labels.map((_, index) => sanitizeCaption(fields[`caption${index}`]));
  const captionIndexes = captions
    .map((caption, index) => caption ? index : -1)
    .filter(index => index >= 0);

  return { exportLength, clipLength, starts, captions, captionIndexes };
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

export function buildFilterComplex({ exportLength, captions, captionIndexes }) {
  const chains = [];

  if (captionIndexes.length === 1) {
    chains.push(`[3:v]format=gray[m${captionIndexes[0]}]`);
  } else if (captionIndexes.length > 1) {
    chains.push(`[3:v]format=gray,split=${captionIndexes.length}${captionIndexes.map(index => `[m${index}]`).join('')}`);
  }

  labels.forEach((_, index) => {
    chains.push(`[${index}:v]trim=duration=${exportLength},setpts=PTS-STARTPTS,scale=1080:640:force_original_aspect_ratio=increase,crop=1080:640,setsar=1,fps=30[base${index}]`);

    if (captions[index]) {
      chains.push(`color=c=black:s=1080x640:d=${exportLength},format=rgba[black${index}]`);
      chains.push(`[black${index}][m${index}]alphamerge[grad${index}]`);
      chains.push(`[base${index}][grad${index}]overlay=0:0,${buildDrawText(captions[index], 'h-72')}[v${index}]`);
    } else {
      chains.push(`[base${index}]copy[v${index}]`);
    }
  });

  return `${chains.join(';')};[v0][v1][v2]vstack=inputs=3,format=yuv420p[v]`;
}

export function buildFinalRenderArgs({ segmentPaths, exportLength, captions, captionIndexes, maskPath, outputPath }) {
  const args = ['-y', '-hide_banner'];

  segmentPaths.forEach(segmentPath => {
    args.push('-stream_loop', '-1', '-i', segmentPath);
  });

  if (captionIndexes.length) {
    args.push('-loop', '1', '-t', String(exportLength), '-i', maskPath);
  }

  args.push('-f', 'lavfi', '-t', String(exportLength), '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');
  args.push(
    '-filter_complex', buildFilterComplex({ exportLength, captions, captionIndexes }),
    '-map', '[v]',
    '-map', `${captionIndexes.length ? 4 : 3}:a`,
    '-t', String(exportLength),
    '-c:v', 'libx264',
    '-profile:v', 'high',
    '-level', '4.1',
    '-pix_fmt', 'yuv420p',
    '-r', '30',
    '-crf', '18',
    '-preset', 'veryfast',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-movflags', '+faststart',
    outputPath
  );

  return args;
}
