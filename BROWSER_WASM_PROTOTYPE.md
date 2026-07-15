# Browser ffmpeg.wasm prototype

This branch replaces the UI's MP4 request to `/api/render` with a browser-only
ffmpeg.wasm technical validation. PNG export remains the existing Canvas path.
The native Node/FFmpeg renderer remains in the repository as a correctness
baseline and fallback while the prototype is evaluated.

## Fixed validation target

- 720 × 1280
- 30fps
- H.264, yuv420p, faststart
- Silent AAC track
- Three equal-height, cover-cropped sections
- Per-source segment start and looping
- Optional Canvas-rendered captions
- 1–10 second output using the existing UI limits

1080p and 60fps are intentionally disabled for browser MP4 export during this
validation. PNG export still supports both existing resolutions.

## Runtime design

- `@ffmpeg/ffmpeg` 0.12.15 and the single-thread `@ffmpeg/core` 0.12.10 are
  pinned in `package-lock.json`.
- Browser assets are copied into `public/vendor/` by `npm run vendor:ffmpeg` so
  GitHub Pages does not depend on a third-party runtime CDN.
- After the first valid source is selected, the single-thread core starts
  loading in the background. A versioned service-worker cache stores the core
  JavaScript and WASM assets on demand so later visits do not normally download
  the approximately 32MB runtime again. Bump the cache version in `public/sw.js`
  whenever either core asset changes.
- Source `File` objects are mounted with WORKERFS instead of being copied into
  MEMFS before processing.
- Each selected segment is cropped to 720 × 428 and encoded with the ultrafast
  preset. The three small segments are then looped, stacked, cropped to exactly
  720 × 1280, and encoded into the final MP4 with the speed-oriented
  `superfast` preset and CRF 21.
- Captions and gradients are drawn into one transparent Canvas PNG and overlaid
  during final encoding. This avoids shipping a large CJK font into WASM and
  keeps caption placement aligned with the preview renderer.
- Cancel terminates the ffmpeg Worker. A later retry creates and loads a fresh
  Worker without clearing source selections or settings.

## Performance measurements

The export panel records total wall-clock time plus core loading, each source
segment, final composition, and output-read timing. In Chromium, it also samples
`performance.memory.usedJSHeapSize` every 250ms and reports the largest value.

The displayed memory number is explicitly a **JS heap estimate**. It may omit
WASM Worker memory, decoded media buffers, GPU allocations, and other browser
process overhead. Firefox and Safari normally report the metric as unavailable.
Use browser task-manager or OS process telemetry when deciding production
limits.

## Local verification

```powershell
npm install
npm run vendor:ffmpeg
npm run check
npm test
npm run start:wasm
```

Open `http://127.0.0.1:4173/`, select three short fixtures, preview the selected
segments, and export MP4. Verify:

1. The core loads from `/vendor/ffmpeg-core/` with no CORS or MIME error.
2. Selecting a valid source starts background core loading; after the first
   cached load, a refresh can serve both core assets through `public/sw.js`.
3. Status advances through three preparation stages and final encoding.
4. Cancel preserves all sources, starts, captions, and export settings.
5. Success downloads a non-empty MP4 and shows stage timings and heap estimate.
6. FFprobe reports 720 × 1280, 30fps, H.264, AAC, and yuv420p.

The browser-only static server uses port `4173` by default. Override it without
affecting the existing backend development server:

```powershell
$env:STATIC_PORT='4174'
npm run start:wasm
```

## Distribution note

`@ffmpeg/core` is published as GPL-2.0-or-later. See
`public/THIRD_PARTY_NOTICES.md` and the pinned upstream source before publishing
or changing how the WASM binary is distributed.
