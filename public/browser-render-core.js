import { getOutputGeometry } from './composition-core.js';

export const BROWSER_VIDEO_RESOLUTION = 720;
export const BROWSER_VIDEO_FRAME_RATE = 30;
export const BROWSER_RENDER_TIMEOUT_MS = 10 * 60 * 1000;

export function buildBrowserSegmentArgs({ inputPath, outputPath, start, clipLength }) {
  const geometry = getOutputGeometry(BROWSER_VIDEO_RESOLUTION);
  const videoFilter = [
    `scale=${geometry.width}:${geometry.ffmpegSectionHeight}:force_original_aspect_ratio=increase`,
    `crop=${geometry.width}:${geometry.ffmpegSectionHeight}`,
    'setsar=1',
    `fps=${BROWSER_VIDEO_FRAME_RATE}`
  ].join(',');

  return [
    '-hide_banner',
    '-ss', String(start),
    '-t', String(clipLength),
    '-i', inputPath,
    '-an',
    '-vf', videoFilter,
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-preset', 'ultrafast',
    '-crf', '20',
    '-threads', '1',
    outputPath
  ];
}

export function buildBrowserFinalArgs({ segmentPaths, outputPath, exportLength, captionOverlayPath = '' }) {
  const geometry = getOutputGeometry(BROWSER_VIDEO_RESOLUTION);
  const args = ['-hide_banner'];

  segmentPaths.forEach(segmentPath => {
    args.push('-stream_loop', '-1', '-i', segmentPath);
  });

  if (captionOverlayPath) {
    args.push('-loop', '1', '-t', String(exportLength), '-i', captionOverlayPath);
  }

  const audioInputIndex = captionOverlayPath ? 4 : 3;
  args.push('-f', 'lavfi', '-t', String(exportLength), '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');

  const chains = segmentPaths.map((_, index) => (
    `[${index}:v]trim=duration=${exportLength},setpts=PTS-STARTPTS,fps=${BROWSER_VIDEO_FRAME_RATE}[v${index}]`
  ));
  const stack = `[v0][v1][v2]vstack=inputs=3,crop=${geometry.width}:${geometry.height}`;
  chains.push(captionOverlayPath
    ? `${stack}[stack];[stack][3:v]overlay=0:0:shortest=1,format=yuv420p[v]`
    : `${stack},format=yuv420p[v]`);

  args.push(
    '-filter_complex', chains.join(';'),
    '-map', '[v]',
    '-map', `${audioInputIndex}:a`,
    '-t', String(exportLength),
    '-c:v', 'libx264',
    '-profile:v', 'high',
    '-level', '4.1',
    '-pix_fmt', 'yuv420p',
    '-r', String(BROWSER_VIDEO_FRAME_RATE),
    '-crf', '18',
    '-preset', 'veryfast',
    '-threads', '1',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-movflags', '+faststart',
    outputPath
  );

  return args;
}

export function getBrowserRenderProgress(stageIndex, stageProgress) {
  const safeStage = Math.max(0, Math.min(3, Number(stageIndex) || 0));
  const safeProgress = Math.max(0, Math.min(1, Number(stageProgress) || 0));
  const stageWeights = [0.15, 0.15, 0.15, 0.55];
  const completed = stageWeights.slice(0, safeStage).reduce((sum, weight) => sum + weight, 0);
  return Math.round((completed + stageWeights[safeStage] * safeProgress) * 100);
}

export function readUsedJsHeapSize(performanceApi = globalThis.performance) {
  const bytes = Number(performanceApi?.memory?.usedJSHeapSize);
  return Number.isFinite(bytes) && bytes > 0 ? bytes : null;
}

export function formatDurationMs(milliseconds) {
  const totalSeconds = Math.max(0, Number(milliseconds) || 0) / 1000;
  if (totalSeconds < 60) return `${totalSeconds.toFixed(1)} 秒`;
  const minutes = Math.floor(totalSeconds / 60);
  return `${minutes} 分 ${(totalSeconds - minutes * 60).toFixed(1)} 秒`;
}

export function formatMemoryBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return '当前浏览器不可用';
  return `${(value / (1024 * 1024)).toFixed(0)} MB`;
}
