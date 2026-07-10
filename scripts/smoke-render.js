import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateFixtures, fixtureDir } from './generate-fixtures.js';
import { describeMediaTools, runFfmpeg, runFfprobe } from './media-tools.js';
import {
  decodeSampleStrip,
  expectedColorsAt,
  fixtures,
  sampleTimes,
  smokeSettings,
  validateProbeResult,
  validateSampleColors
} from './smoke-core.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const resultDir = path.join(repoRoot, 'tmp', 'smoke-results');
const requestTimeoutMs = Number(process.env.SMOKE_RENDER_TIMEOUT_MS || 180000);
const targets = {
  direct: process.env.SMOKE_DIRECT_URL || 'http://127.0.0.1:3000/api/render',
  proxy: process.env.SMOKE_PROXY_URL || 'http://127.0.0.1:3001/api/render'
};

function selectedTargets() {
  const argument = process.argv.find(value => value.startsWith('--target='));
  const target = argument?.split('=')[1] || 'all';
  if (target === 'all') return ['direct', 'proxy'];
  if (!targets[target]) throw new Error(`Unknown target "${target}". Use direct, proxy, or all.`);
  return [target];
}

async function assertHealthy(renderUrl) {
  const healthUrl = new URL('/api/health', renderUrl);
  const response = await fetch(healthUrl, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`Health check ${healthUrl} returned HTTP ${response.status}.`);
  const body = await response.json();
  if (!body.ok) throw new Error(`Health check ${healthUrl} did not return { ok: true }.`);
}

async function buildRenderForm() {
  const form = new FormData();
  for (const fixture of fixtures) {
    const data = await fsp.readFile(path.join(fixtureDir, fixture.filename));
    form.append(fixture.slot, new Blob([data], { type: 'video/mp4' }), fixture.filename);
  }
  smokeSettings.starts.forEach((start, index) => form.append(`start${index}`, String(start)));
  smokeSettings.captions.forEach((caption, index) => form.append(`caption${index}`, caption));
  form.append('clipLength', String(smokeSettings.clipLength));
  form.append('exportLength', String(smokeSettings.exportLength));
  return form;
}

async function requestRender(target, renderUrl) {
  await assertHealthy(renderUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    const response = await fetch(renderUrl, {
      method: 'POST',
      body: await buildRenderForm(),
      signal: controller.signal
    });
    const body = Buffer.from(await response.arrayBuffer());
    if (!response.ok) {
      const message = body.toString('utf8').slice(0, 1000);
      throw new Error(`${target} render returned HTTP ${response.status}: ${message}`);
    }
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.toLowerCase().startsWith('video/mp4')) {
      throw new Error(`${target} render returned ${contentType || 'no content type'} instead of video/mp4.`);
    }
    if (body.length < 10 * 1024) throw new Error(`${target} render output is unexpectedly small (${body.length} bytes).`);
    return body;
  } finally {
    clearTimeout(timer);
  }
}

async function probeVideo(video) {
  const { stdout } = await runFfprobe([
    '-v', 'error',
    '-show_entries', 'stream=codec_type,codec_name,width,height,pix_fmt,r_frame_rate:format=duration',
    '-of', 'json',
    'pipe:0'
  ], { input: video, stdoutLimit: 1024 * 1024 });
  const probe = JSON.parse(stdout.toString('utf8'));
  return validateProbeResult(probe);
}

async function sampleFrame(video, time) {
  const filter = [
    '[0:v]split=3[top][middle][bottom]',
    '[top]crop=16:16:532:312,scale=2:2:flags=area[topSample]',
    '[middle]crop=16:16:532:952,scale=2:2:flags=area[middleSample]',
    '[bottom]crop=16:16:532:1592,scale=2:2:flags=area[bottomSample]',
    '[topSample][middleSample][bottomSample]hstack=inputs=3,format=rgb24[out]'
  ].join(';');
  const { stdout } = await runFfmpeg([
    '-v', 'error',
    '-i', 'pipe:0',
    '-ss', String(time),
    '-filter_complex', filter,
    '-map', '[out]',
    '-frames:v', '1',
    '-f', 'rawvideo',
    '-pix_fmt', 'rgb24',
    'pipe:1'
  ], { input: video, stdoutLimit: 1024 * 1024 });
  return decodeSampleStrip(stdout);
}

async function extractReviewFrame(video) {
  const { stdout } = await runFfmpeg([
    '-v', 'error',
    '-i', 'pipe:0',
    '-ss', '0.25',
    '-frames:v', '1',
    '-f', 'image2pipe',
    '-vcodec', 'png',
    'pipe:1'
  ], { input: video, stdoutLimit: 16 * 1024 * 1024 });
  if (!stdout.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw new Error('Review frame is not a valid PNG.');
  }
  const width = stdout.readUInt32BE(16);
  const height = stdout.readUInt32BE(20);
  if (width !== 1080 || height !== 1920) throw new Error(`Review frame is ${width}x${height}, expected 1080x1920.`);
  return stdout;
}

async function verifyTarget(target) {
  const video = await requestRender(target, targets[target]);
  const outputPath = path.join(resultDir, `${target}.mp4`);
  await fsp.writeFile(outputPath, video);
  const metadata = await probeVideo(video);

  for (const time of sampleTimes) {
    const actual = await sampleFrame(video, time);
    const expected = expectedColorsAt(time);
    validateSampleColors(actual, expected);
    console.log(`${target}: frame ${time.toFixed(2)}s colors ${actual.map(rgb => rgb.join(',')).join(' | ')}`);
  }

  const reviewFrame = await extractReviewFrame(video);
  const framePath = path.join(resultDir, `${target}-frame.png`);
  await fsp.writeFile(framePath, reviewFrame);
  console.log(
    `${target}: PASS, ${video.length} bytes, ${metadata.duration.toFixed(2)}s, `
    + `${path.relative(repoRoot, outputPath)}, ${path.relative(repoRoot, framePath)}`
  );
}

async function main() {
  await fsp.mkdir(resultDir, { recursive: true });
  console.log(`Media tools: ${await describeMediaTools()}`);
  await generateFixtures();
  for (const target of selectedTargets()) await verifyTarget(target);
  console.log('Render smoke test passed.');
}

main().catch(error => {
  const timeout = error?.name === 'AbortError' ? `Render exceeded ${requestTimeoutMs}ms. ` : '';
  console.error(`Render smoke test failed: ${timeout}${error.message}`);
  process.exitCode = 1;
});
