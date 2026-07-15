import { FFmpeg } from './vendor/ffmpeg/index.js';
import {
  BROWSER_RENDER_TIMEOUT_MS,
  buildBrowserFinalArgs,
  buildBrowserSegmentArgs,
  getBrowserRenderProgress
} from './browser-render-core.js';

const CORE_URL = new URL('./vendor/ffmpeg-core/ffmpeg-core.js', import.meta.url).href;
const WASM_URL = new URL('./vendor/ffmpeg-core/ffmpeg-core.wasm', import.meta.url).href;

function fileExtension(file) {
  const name = String(file?.name || 'video.mp4');
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot).toLowerCase() : '.mp4';
}

export class BrowserFfmpegRenderer {
  constructor() {
    this.ffmpeg = null;
    this.loadingPromise = null;
    this.currentStage = 0;
    this.onProgress = null;
    this.onStage = null;
    this.logTail = [];
    this.cancelled = false;
  }

  createInstance() {
    const ffmpeg = new FFmpeg();
    ffmpeg.on('log', ({ message }) => {
      this.logTail.push(String(message || ''));
      this.logTail = this.logTail.slice(-12);
    });
    ffmpeg.on('progress', ({ progress }) => {
      this.onProgress?.(getBrowserRenderProgress(this.currentStage, progress));
    });
    this.ffmpeg = ffmpeg;
    return ffmpeg;
  }

  async ensureLoaded() {
    if (this.ffmpeg?.loaded) return 0;
    if (this.loadingPromise) return this.loadingPromise;

    const startedAt = performance.now();
    const ffmpeg = this.ffmpeg || this.createInstance();
    this.onStage?.('正在加载约 32MB 的浏览器编码核心…');
    this.loadingPromise = ffmpeg.load({ coreURL: CORE_URL, wasmURL: WASM_URL })
      .then(() => performance.now() - startedAt)
      .catch(error => {
        if (this.ffmpeg === ffmpeg) {
          ffmpeg.terminate();
          this.ffmpeg = null;
        }
        throw error;
      })
      .finally(() => { this.loadingPromise = null; });
    return this.loadingPromise;
  }

  async safeDelete(path) {
    try {
      await this.ffmpeg?.deleteFile(path);
    } catch {
      // A missing temporary file is already clean.
    }
  }

  async safeUnmount(path) {
    try {
      await this.ffmpeg?.unmount(path);
    } catch {
      // An unmounted input directory is already clean.
    }
  }

  async execute(args, stageIndex, stageLabel) {
    this.currentStage = stageIndex;
    this.onStage?.(stageLabel);
    const exitCode = await this.ffmpeg.exec(args, BROWSER_RENDER_TIMEOUT_MS);
    if (exitCode !== 0) {
      throw new Error('浏览器视频编码失败，请缩短素材或关闭其他占用内存的页面后重试。');
    }
  }

  async render({ files, starts, clipLength, exportLength, captionOverlay, onProgress, onStage }) {
    this.cancelled = false;
    this.onProgress = onProgress;
    this.onStage = onStage;
    this.logTail = [];
    const totalStartedAt = performance.now();
    let loadMs = 0;
    let encodeStartedAt = 0;
    const segmentPaths = files.map((_, index) => `segment-${index}.mp4`);
    const inputDirs = files.map((_, index) => `/input-${index}`);
    const overlayPath = captionOverlay ? 'caption-overlay.png' : '';
    const outputPath = 'clip-trio-browser.mp4';

    try {
      loadMs = await this.ensureLoaded();
      encodeStartedAt = performance.now();
      for (let index = 0; index < files.length; index += 1) {
        const inputDir = inputDirs[index];
        try { await this.ffmpeg.createDir(inputDir); } catch {}
        await this.ffmpeg.mount('WORKERFS', { files: [files[index]] }, inputDir);
        const inputPath = `${inputDir}/${files[index].name}`;
        await this.execute(buildBrowserSegmentArgs({
          inputPath,
          outputPath: segmentPaths[index],
          start: starts[index],
          clipLength
        }), index, `正在准备${['上方', '中间', '下方'][index]}片段（${index + 1}/3）…`);
      }

      if (captionOverlay) {
        await this.ffmpeg.writeFile(overlayPath, captionOverlay);
      }

      await this.execute(buildBrowserFinalArgs({
        segmentPaths,
        outputPath,
        exportLength,
        captionOverlayPath: overlayPath
      }), 3, '正在合成并编码 720×1280 / 30fps MP4…');

      const data = await this.ffmpeg.readFile(outputPath);
      const encodeMs = performance.now() - encodeStartedAt;
      return {
        blob: new Blob([data.buffer], { type: 'video/mp4' }),
        loadMs,
        encodeMs,
        totalMs: performance.now() - totalStartedAt
      };
    } catch (error) {
      if (this.cancelled) throw new DOMException('用户取消了浏览器导出。', 'AbortError');
      throw error;
    } finally {
      if (this.ffmpeg?.loaded) {
        await Promise.all(inputDirs.map(path => this.safeUnmount(path)));
        await Promise.all([...segmentPaths, overlayPath, outputPath].filter(Boolean).map(path => this.safeDelete(path)));
      }
      this.onProgress = null;
      this.onStage = null;
    }
  }

  cancel() {
    this.cancelled = true;
    this.ffmpeg?.terminate();
    this.ffmpeg = null;
    this.loadingPromise = null;
  }
}
