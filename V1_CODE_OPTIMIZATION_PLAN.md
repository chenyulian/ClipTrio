# ClipTrio PC Web V1 Optimization Plan

Date: 2026-07-10

This plan is intended for coding agents continuing the PC Web V1 hardening work. Read `AGENTS.md` first, then use this file as the execution checklist.

## Current State

ClipTrio is a dependency-free Node.js single-page web app.

Recent work completed:

- PC Web light theme and three-panel editor layout.
- Clearer source selection workflow.
- Segment selection UI with disabled empty states before source videos are selected.
- Preview transport and export inspector.
- MP4 export through `/api/render`.
- PNG triptych export from the current preview frame.
- Persistent export error display.
- Optional local render proxy via `RENDER_PROXY_URL`.
- `server-core.js` extracted for pure backend render logic.
- Node built-in tests for backend sanitization and FFmpeg argument construction.

Primary product target remains PC Web V1. Mobile Web polish is later work.

## How To Work

For each task:

1. Read `AGENTS.md`.
2. Check `git status --short`.
3. Keep the change focused.
4. Preserve current product behavior unless the task explicitly changes it.
5. Run the smallest relevant checks.
6. Update docs only when behavior, setup, architecture, or troubleshooting changes.

Recommended local development:

```powershell
$env:PORT='3001'
$env:RENDER_PROXY_URL='http://127.0.0.1:3000/api/render'
npm start
```

Open:

```text
http://127.0.0.1:3001/
```

## Phase 1: Stabilize Current Frontend Interactions

Goal: remove confusion and preserve user work across normal editing.

Status: completed on 2026-07-13.

Implemented:

- Segment and caption controls remain disabled until their source slot is ready.
- Single-slot replacement validates the new video before committing and releasing the old object URL/video element.
- Three-file replacement validates every file and duration before committing all slots together.
- Invalid type, per-file size, duration, count, and total-size issues remain visible beside the relevant source controls.
- Export readiness includes the total-size rule and shows the blocking reason beside the disabled export button.
- Export failure changes status only; selected files, segment starts, captions, export mode, and duration settings remain intact.
- File inputs reset after each attempt so users can retry the same file.

Verification completed:

- Frontend validation/readiness tests added with Node's built-in test runner.
- Empty state checked at 1280 x 720 and 1440 x 900 with no horizontal overflow.
- Browser module loaded without console errors.
- Docker direct and local proxy MP4 smoke tests passed after the change.

Tasks:

- Add clear disabled or empty states for controls that depend on missing inputs.
- Make caption inputs follow the same availability model as segment controls, if product direction agrees.
- Preserve all selected files, segment starts, captions, and export settings after export failures.
- Ensure switching MP4/PNG mode does not reset unrelated settings.
- Ensure replacing one source video only resets that slot's segment start when necessary.
- Add visible inline validation for unsupported file type, file too large, too many files, video too long, and total upload too large.
- Keep export button disabled with a nearby explanation until all required inputs are ready.

Verification:

- Empty state.
- One source selected.
- Two sources selected.
- Three sources selected.
- Replace top/middle/bottom individually.
- Switch MP4 to PNG and back.
- Trigger an export error and confirm inputs remain intact.

## Phase 2: Extract Frontend Pure Helpers

Goal: make frontend behavior testable without changing UI.

Suggested extraction order from `public/index.html`:

1. Formatting helpers:
   - `formatSize`
   - `formatTime`
   - `sanitizeCaption`
   - `clamp`
2. Timing helpers:
   - clip length normalization
   - export length normalization
   - segment start calculation
   - segment end calculation
3. Readiness helpers:
   - ready count
   - total bytes
   - export availability
   - per-slot control availability
4. Export-mode helpers:
   - MP4 facts
   - PNG facts
   - button label
   - checklist text

Recommended output:

- Add `public/app-core.js` or another small module for pure logic.
- Add `test/frontend-core.test.js`.
- Do not introduce a bundler unless explicitly approved.

Verification:

```powershell
npm test
node -e "const fs=require('fs');const h=fs.readFileSync('public/index.html','utf8');for(const m of h.matchAll(/<script>([\s\S]*?)<\/script>/g))new Function(m[1]);console.log('ok')"
```

## Phase 3: Backend Render Reliability

Goal: make MP4 export failure modes predictable and recoverable.

Tasks:

- Add tests for multipart parsing and malformed requests.
- Add tests for missing required files.
- Add tests for invalid extensions.
- Add tests for oversized file and oversized total upload behavior.
- Add tests for render proxy success and upstream error propagation.
- Add subprocess timeout handling for FFmpeg and FFprobe.
- Keep stderr capture bounded.
- Ensure every render job temporary directory is removed on success, validation failure, subprocess failure, client disconnect, and proxy failure.
- Return user-facing errors without raw filesystem paths or stack traces.

Suggested extraction:

- `server-core.js`: pure validation and FFmpeg argument logic.
- `server-http.js` or similar later: request parsing/routing helpers.

Avoid changing `/api/render` contract unless tests and docs are updated together.

## Phase 4: Export Verification Fixtures

Goal: make MP4 and PNG export easy to smoke test.

Status: completed on 2026-07-10 for automated MP4 direct/proxy verification. Browser Canvas PNG uses the documented deterministic manual check until Phase 6 extracts testable Canvas composition helpers.

Tasks:

- Add a small script to generate deterministic test videos with FFmpeg.
- Do not commit generated videos.
- Add a documented smoke-test flow for Docker renderer and local proxy renderer.
- Validate output MIME type and non-empty file size.
- Inspect at least one frame from top, middle, and bottom sections.
- Compare selected segment starts against expected colors or timestamps.

Possible scripts:

- `npm run fixtures`
- `npm run smoke:render`

Only add scripts when they run real checks.

## Phase 5: Frontend Structure Cleanup

Goal: reduce `public/index.html` size while preserving the no-build setup.

Tasks:

- Move pure logic to `public/app-core.js`.
- Move browser-side app orchestration to `public/app.js`.
- Keep HTML semantic and stable.
- Keep CSS in the HTML or move to `public/styles.css`; choose the smaller diff.
- Avoid framework migration.
- Avoid unrelated visual redesign.

Recommended order:

1. Extract pure helpers.
2. Extract DOM query constants.
3. Extract state update functions.
4. Extract file loading and cleanup.
5. Extract preview drawing.
6. Extract export transport.

Stop after each step and verify.

## Phase 6: Preview And Export Consistency

Goal: make Canvas preview, PNG export, and MP4 export match as closely as practical.

Tasks:

- Centralize layout constants:
  - output width: 1080
  - output height: 1920
  - section height: 640
  - caption baseline
  - caption gradient start and opacity
- Document where browser Canvas and FFmpeg implementations intentionally differ.
- Add visual smoke checks for PNG dimensions and section boundaries.
- If caption styling changes, update both Canvas drawing and FFmpeg filter logic.

## Phase 7: Product Polish Backlog

These are product/UI tasks, not code-hardening tasks. Run them only when explicitly requested.

- More precise segment handles with visible start/end time editing.
- Per-slot reset button.
- Per-slot mute/audio policy if future exports include source audio.
- Optional caption style controls.
- Recent exports panel.
- Drag-to-reorder slots.
- Mobile Web layout.
- 2K/4K output modes.
- Batch generation.

## Recommended Agent Prompts

Use one of these prompts in a new coding-agent task.

### Prompt A: Frontend Interaction Hardening

```text
Read AGENTS.md and V1_CODE_OPTIMIZATION_PLAN.md. Execute Phase 1 only. Keep behavior scoped to PC Web V1. Do not redesign the app. Preserve export behavior. Add clear empty/disabled/invalid states for controls that depend on selected source videos. Verify with npm test, frontend script parse check, and browser inspection at 1280x720.
```

### Prompt B: Frontend Pure Helper Extraction

```text
Read AGENTS.md and V1_CODE_OPTIMIZATION_PLAN.md. Execute Phase 2 only. Extract frontend pure formatting, timing, readiness, and export-mode helpers from public/index.html into a no-build module. Add Node built-in tests. Do not change visible behavior. Verify with npm test and browser smoke check.
```

### Prompt C: Backend Render Reliability

```text
Read AGENTS.md and V1_CODE_OPTIMIZATION_PLAN.md. Execute Phase 3 only. Add focused Node built-in tests around multipart validation, render request validation, proxy error propagation, and subprocess timeout/cleanup behavior. Keep /api/render behavior compatible. Do not change UI except for error text if needed.
```

### Prompt D: Render Smoke Fixtures

```text
Read AGENTS.md and V1_CODE_OPTIMIZATION_PLAN.md. Execute Phase 4 only. Add deterministic render smoke-test fixtures and scripts without committing generated videos. Verify direct Docker render and local 3001 proxy render. Document the workflow.
```

## Stop Conditions

Stop and ask before:

- Migrating to React, Vue, TypeScript, Vite, or another framework.
- Adding third-party dependencies.
- Changing the `/api/render` request or response contract.
- Changing export resolution, codec, crop behavior, caption styling, or default durations.
- Removing any existing product feature.
- Force-pushing, deleting files, or cleaning the worktree.
