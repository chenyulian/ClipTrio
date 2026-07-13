import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildFinalRenderArgs,
  buildSegmentArgs,
  normalizeRenderFields
} from './server-core.js';
import { createClipTrioServer } from './server-http.js';
import { probeDuration, runCommand } from './server-process.js';
import {
  CAPTION_GRADIENT_START,
  FFMPEG_GRADIENT_BASE_OPACITY,
  FFMPEG_GRADIENT_EXPONENT,
  FFMPEG_GRADIENT_OPACITY_RANGE,
  OUTPUT_WIDTH,
  SECTION_HEIGHT
} from './public/composition-core.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, 'public');
const tmpRoot = path.join(__dirname, 'tmp');
const port = Number(process.env.PORT || 3000);
const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';
const ffprobePath = process.env.FFPROBE_PATH || 'ffprobe';
const renderProxyUrl = process.env.RENDER_PROXY_URL || '';
const renderProxyTimeoutMs = Number(process.env.RENDER_PROXY_TIMEOUT_MS || 130000);

export async function writeGradientMask(maskPath, width = OUTPUT_WIDTH, height = SECTION_HEIGHT) {
  const header = Buffer.from(`P5\n${width} ${height}\n255\n`, 'ascii');
  const pixels = Buffer.alloc(width * height);
  const start = CAPTION_GRADIENT_START;
  const span = 1 - start;

  for (let y = 0; y < height; y += 1) {
    const normalizedY = y / (height - 1);
    const progress = Math.max(0, Math.min(1, (normalizedY - start) / span));
    const opacity = progress === 0
      ? 0
      : FFMPEG_GRADIENT_BASE_OPACITY + FFMPEG_GRADIENT_OPACITY_RANGE * Math.pow(progress, FFMPEG_GRADIENT_EXPONENT);

    for (let x = 0; x < width; x += 1) {
      const dither = (((x * 13 + y * 17) % 7) - 3) / 255;
      const alpha = Math.max(0, Math.min(255, Math.round((opacity + dither) * 255)));
      pixels[y * width + x] = alpha;
    }
  }

  await fsp.writeFile(maskPath, Buffer.concat([header, pixels]));
}

export async function renderMp4(files, fields, jobDir, options = {}) {
  const { signal } = options;
  const { exportLength, clipLength, starts, captions, captionIndexes } = normalizeRenderFields(fields);
  const outputPath = path.join(jobDir, 'triptych.mp4');
  const maskPath = path.join(jobDir, 'caption-gradient.pgm');
  const segmentPaths = [];

  for (let index = 0; index < files.length; index += 1) {
    const segmentPath = path.join(jobDir, `segment-${index}.mp4`);
    segmentPaths.push(segmentPath);
    await runCommand(ffmpegPath, buildSegmentArgs({
      start: starts[index],
      clipLength,
      inputPath: files[index].path,
      outputPath: segmentPath
    }), jobDir, { label: 'FFmpeg segment render', signal });
  }

  if (captionIndexes.length) {
    await writeGradientMask(maskPath);
  }

  await runCommand(ffmpegPath, buildFinalRenderArgs({
    segmentPaths,
    exportLength,
    captions,
    captionIndexes,
    maskPath,
    outputPath
  }), jobDir, { label: 'FFmpeg final render', signal });
  return outputPath;
}

await fsp.mkdir(tmpRoot, { recursive: true });

const server = createClipTrioServer({
  publicDir,
  tmpRoot,
  renderProxyUrl,
  renderProxyTimeoutMs,
  probeVideo: (filePath, jobDir, options) => probeDuration(ffprobePath, filePath, jobDir, options),
  renderVideo: renderMp4
});

server.listen(port, () => {
  console.log(`ClipTrio running at http://localhost:${port}`);
});
