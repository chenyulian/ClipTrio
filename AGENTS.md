# ClipTrio Coding Agent Guide

## Mission

ClipTrio turns three source videos into a share-ready 9:16 vertical triptych.

V1 is the PC Web product. The current priority is code quality, reliability, maintainability, and export correctness. Mobile Web optimization is explicitly later work unless a task says otherwise.

Work as a senior product engineer. Preserve the fast single-page workflow while reducing technical debt in small, verifiable steps.

## Product Contract

The core workflow must remain:

1. Select or drag three videos into the top, middle, and bottom slots.
2. Select a segment start and loop length for each video.
3. Add an optional caption to each segment.
4. Preview the combined vertical result at the selected export resolution.
5. Choose an export mode.
6. Export either an H.264 MP4 or the current preview frame as a PNG triptych.

Current output behavior:

- Two output presets: 1080 x 1920 and 720 x 1280.
- Three equal-height sections (subject to final pixel rasterization at 720 x 1280).
- No gaps between sections.
- Cover-style scaling and centered cropping.
- Optional bottom-centered captions.
- Video: H.264 MP4, selected resolution, 30fps or 60fps, yuv420p, faststart.
- Image: PNG, selected resolution, based on the current preview frame.

Do not silently change these semantics.

## Repository Map

- `public/index.html`
  - No-build frontend entry.
  - Contains the semantic HTML and CSS for the single-page editor.
- `public/app-core.js`
  - Pure frontend formatting, timing, readiness, and export-mode helpers.
  - Covered by Node built-in tests.
- `public/app.js`
  - Browser orchestration, file-slot lifecycle, preview transport, and export transport.
- `public/canvas-renderer.js`
  - Canvas preview/PNG composition with testable drawing boundaries.
- `public/composition-core.js`
  - Shared output geometry and caption parameters used by Canvas and FFmpeg.
- `server.js`
  - Dependency-free Node HTTP server.
  - Probes videos and renders MP4 through FFmpeg.
- `server-http.js`
  - Testable HTTP routing, multipart parsing, static serving, proxy transport, request cancellation, and render-job cleanup.
- `server-core.js`
  - Pure backend validation, render-field normalization, error mapping, and FFmpeg argument construction.
- `server-process.js`
  - Bounded FFmpeg/FFprobe execution with timeout handling.
- `scripts/`
  - Deterministic fixture generation and direct/proxy MP4 smoke verification.
- `test/`
  - Node built-in tests for frontend helpers, backend helpers, process handling, validation, and smoke-test logic.
- `Dockerfile`
  - Production image with Node, FFmpeg, FFprobe, and Noto CJK fonts.
- `docker-compose.yml`
  - Runs the Docker service on port 3000.
- `PC_WEB_V1_OPTIMIZATION_LOG.md`
  - Product and interaction decisions made during PC V1 iteration.
- `EXPORT_TROUBLESHOOTING_LOG.md`
  - Export failure history, runtime topology, and recovery notes.
- `PROJECT_NOTES.md`
  - Broader technical history.
- `PRODUCT_DIRECTION.md`
  - Longer-term product direction. Do not use it to expand V1 scope without a direct task.
- `RENDER_SMOKE_TEST.md`
  - Deterministic MP4 fixture and direct/proxy smoke-test workflow.
- `V1_CODE_OPTIMIZATION_PLAN.md`
  - Current V1 hardening phases, status, and agent-ready execution prompts.

## Current Hardening Status

Completed:

- Phase 1: dependency controls, atomic source replacement, persistent inline validation, export readiness, and failure-state preservation hardened.
- Phase 2: frontend pure helpers extracted to `public/app-core.js` with tests.
- Phase 3 core implementation: backend validation, subprocess timeout, bounded output, cleanup paths, and error mapping hardened.
- Phase 3 route coverage: real multipart requests, proxy behavior, static traversal, disconnect cancellation, and cleanup paths covered.
- Phase 4: deterministic MP4 fixtures and Docker direct/local proxy smoke tests added.
- Phase 5: browser orchestration extracted from `public/index.html` without a build system.
- Phase 6: Canvas/FFmpeg layout constants centralized and Canvas composition boundaries covered by tests.

Current priorities:

1. Add an encoded browser-PNG smoke assertion if a dependency-free browser test harness becomes available.
2. Continue small frontend lifecycle extractions only when they add a focused test boundary.
3. Keep route lifecycle and Canvas geometry checks current when render behavior changes.

Do not repeat completed phases unless a regression or a direct task requires it.

## Runtime

Requirements:

- Node.js 18 or newer.
- FFmpeg and FFprobe for local MP4 rendering, or Docker.

Basic local server:

```powershell
npm start
```

Docker renderer:

```powershell
docker compose up -d --build
```

Recommended local UI development setup:

```powershell
$env:PORT='3001'
$env:RENDER_PROXY_URL='http://127.0.0.1:3000/api/render'
npm start
```

Open:

```text
http://127.0.0.1:3001/
```

Health checks:

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:3001/api/health
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:3000/api/health
```

Local GitHub access may require:

```powershell
$env:HTTPS_PROXY='http://127.0.0.1:4780'
$env:HTTP_PROXY='http://127.0.0.1:4780'
```

Do not write proxy settings into the repository.

## V1 Engineering Priorities

Work in this order unless the task requires otherwise.

### P0: Correctness And Recovery

- Keep preview and exported output visually consistent.
- Preserve export errors until the user dismisses them or retries.
- Never discard selected files or settings after an export failure.
- Clean up temporary files and object URLs on success and failure.
- Validate files, durations, sizes, numeric fields, and captions on both client and server.
- Return actionable errors without exposing internal paths or command details.
- Keep MP4 and PNG modes behaviorally separate and explicit.

### P1: Test Coverage

Add focused automated tests before broad refactors.

Current automated coverage includes:

- Numeric and caption sanitization.
- FFmpeg argument construction.
- Export mode state transitions.
- Segment start and duration calculations.
- Render request validation helpers.
- FFmpeg/FFprobe process timeout and bounded stderr behavior.
- Deterministic direct/proxy render output metadata, section order, segment starts, and looping.
- Real HTTP multipart success and malformed requests.
- Route-level validation, proxy propagation/failures/timeouts, and static path traversal.
- Upload, render, and proxy disconnect cancellation with temporary-directory cleanup.

Highest-value remaining targets:

- Encoded browser Canvas PNG dimensions, section colors, boundaries, and captions.
- Additional browser lifecycle extraction only where it creates a focused automated boundary.

Prefer Node's built-in test runner while the project remains dependency-free:

```powershell
node --test
```

### P1: Controlled Modularization

`public/index.html` and `server.js` are large. Improve them incrementally.

Recommended frontend extraction order:

1. Pure formatting and validation helpers.
2. Export-mode and readiness state.
3. Segment timing calculations.
4. Canvas drawing and PNG export.
5. File-slot loading and cleanup.
6. MP4 transport and error handling.

Recommended backend extraction order:

1. Constants and validation.
2. Multipart parsing.
3. FFprobe and process execution.
4. FFmpeg filter and argument construction.
5. Render job lifecycle.
6. Static routing and proxy transport.

Do not perform a framework migration as incidental cleanup. React, TypeScript, a bundler, or a component library require an explicit task and migration plan.

### P2: Performance And Resource Safety

- Avoid unnecessary Canvas redraws while idle.
- Cancel animation frames and pause videos when appropriate.
- Revoke replaced video object URLs.
- Keep preview dimensions stable.
- Bound upload body size before expensive parsing.
- Avoid unbounded buffering and subprocess output.
- Ensure render jobs have timeout and cleanup behavior.
- Consider concurrency limits before public deployment.

### P2: Developer Experience

- Add `test`, `check`, and development scripts only when they execute real checks.
- Keep startup and renderer requirements documented.
- Prefer deterministic smoke-test fixtures over manual-only testing.
- Update relevant Markdown logs when architecture or operational behavior changes.

## Non-Negotiable Constraints

- Preserve all user changes already present in the worktree.
- Keep edits scoped to the requested behavior.
- Do not redesign the product while doing code cleanup.
- Do not add fake controls for unsupported renderer features.
- Do not weaken server-side validation because the browser validates first.
- Do not use shell-built FFmpeg command strings. Continue using `spawn` with argument arrays.
- Do not expose arbitrary filesystem paths through static serving.
- Do not commit generated videos, PNG exports, upload files, temporary render directories, logs, or secrets.
- Keep source files UTF-8. Some Windows terminals may display Chinese text incorrectly; do not "repair" valid UTF-8 based only on terminal mojibake.
- Avoid adding dependencies for utilities available in Node's standard library.

## API Contract

### `GET /api/health`

Must remain lightweight and return a successful JSON response when the Node service is alive.

### `POST /api/render`

Current multipart fields:

- Files: `top`, `middle`, `bottom`
- Timing: `start0`, `start1`, `start2`, `clipLength`, `exportLength`
- Captions: `caption0`, `caption1`, `caption2`
- Output: `resolution` (`1080` or `720`), `frameRate` (`30` or `60`; MP4 only)

Limits:

- Three required source videos.
- Supported extensions: MOV, MP4, M4V.
- Maximum 120MB per video.
- Maximum approximately 380MB total upload.
- Maximum 30 seconds per source.
- Maximum 8 seconds loop segment.
- Maximum 10 seconds exported video.

If this contract changes:

1. Update frontend and backend together.
2. Add or update tests.
3. Update README and the relevant technical log.
4. Verify direct Docker rendering and proxy rendering.

## Frontend Rules

- Treat the central 9:16 preview as the primary object.
- Keep source selection on the left and export/status on the right.
- Preserve the current light theme unless the task is explicitly visual.
- Use semantic controls and visible focus states.
- Keep loading, empty, invalid, processing, success, and persistent error states.
- Maintain stable control and preview dimensions.
- Avoid layout shifts caused by filenames, status text, or progress updates.
- Do not make mobile-specific compromises in PC V1 code unless they also improve desktop behavior.
- When changing preview rendering, compare it against an exported MP4 using the same inputs and timestamps.

## Backend Rules

- Validate all client-controlled values.
- Keep FFmpeg and FFprobe paths configurable through environment variables.
- Preserve `RENDER_PROXY_URL` behavior for local UI development.
- Use unique per-job temporary directories.
- Remove job directories on success, validation failure, subprocess failure, response close, and client disconnect. The exact control structure may vary, but every terminal path must clean up.
- Capture enough subprocess stderr for actionable errors, but cap retained output.
- Map known infrastructure failures to clear user-facing messages.
- Do not leak raw FFmpeg commands, host paths, or stack traces in HTTP responses.

## Verification

Run the smallest relevant checks during development, then complete this list before finishing a meaningful change.

Syntax:

```powershell
npm run check
```

Do not validate `public/index.html` module scripts with `new Function()`. The page contains an ES module `import`, so browser loading and console inspection are the reliable frontend entry checks.

Tests, when present:

```powershell
npm test
```

Health:

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:3001/api/health
```

UI verification:

- Test at 1440 x 900.
- Test at 1280 x 720.
- Confirm no horizontal overflow.
- Confirm the export action remains visible.
- Confirm empty, ready, processing, success, and error states.
- Confirm switching MP4/PNG mode updates settings, facts, checks, status, and button text.

Render verification:

```powershell
npm run fixtures
npm run smoke:render
```

- `npm run smoke:render` verifies Docker direct rendering and the local 3001 proxy by default.
- It checks response MIME type, non-empty output, H.264/AAC metadata, 1080 x 1920 dimensions, 30fps, yuv420p, selected segment starts, section order, and looping.
- Inspect the generated review frames when caption rendering or gradients change.
- Canvas backing dimensions, section boundaries, cover geometry, caption placement, and shared FFmpeg geometry are automated; the final browser-generated PNG remains a documented visual smoke check in `RENDER_SMOKE_TEST.md`.

## Definition Of Done

A change is complete only when:

- The requested behavior works end to end.
- Existing MP4 and PNG export paths still work.
- Relevant automated tests pass, or missing coverage is stated clearly.
- Syntax checks pass.
- Browser console has no new errors.
- Temporary files and processes are cleaned up.
- User-visible failures are persistent and actionable.
- Documentation is updated when contracts, setup, or architecture changed.
- The diff contains no unrelated formatting churn or generated artifacts.

## Git Discipline

- Check `git status` before editing.
- Do not revert unrelated user changes.
- Keep commits focused and describe user-visible behavior.
- Do not include untracked notes or generated artifacts unless the task requires them.
- The remote repository is:

```text
https://github.com/nekohatch/ClipTrio.git
```

- Never force-push unless explicitly requested.

## Recommended Next Optimization Pass

For an agent continuing V1 hardening:

1. Read `V1_CODE_OPTIMIZATION_PLAN.md` and confirm the current phase status.
2. Add an encoded browser-PNG smoke assertion if a dependency-free browser test harness becomes available.
3. Extract smaller browser lifecycle units from `public/app.js` only alongside focused tests.
4. Keep direct Docker and local proxy smoke verification current after render changes.

Avoid a full rewrite. V1 benefits more from tested boundaries and predictable failure recovery than from a new framework.
