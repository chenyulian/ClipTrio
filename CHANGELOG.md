# Changelog

All notable ClipTrio releases are documented here.

## [1.0.0] - Unreleased

First stable PC Web release using the native FFmpeg rendering service.

### Added

- Three-slot video selection with drag-and-drop, per-slot replacement, reset, and reordering.
- Precise per-source segment start editing and shared loop-length controls.
- Optional captions for the top, middle, and bottom sections.
- Live 9:16 Canvas preview with 1080 × 1920 and 720 × 1280 presets.
- H.264 MP4 export at 30fps or 60fps with yuv420p, faststart, and a silent AAC track.
- PNG export from the current preview frame.
- Session-scoped recent export history.
- Deterministic direct-render and local-proxy MP4 smoke verification.

### Reliability

- Client and server validation for source type, size, duration, timing, captions, resolution, and frame rate.
- Bounded FFmpeg/FFprobe execution time and retained process output.
- Request cancellation and temporary render-directory cleanup across success and failure paths.
- Persistent actionable export failures that preserve the selected sources and settings.
- Shared Canvas and FFmpeg composition geometry with focused Node test coverage.

### Release scope

- This release is the PC Web server-rendered product.
- The browser-only ffmpeg.wasm implementation remains a separate technical preview and is not included in the `v1.0.0` tag.
- Mobile Web layout and touch-specific interaction work are planned for a later release.

### Licensing

- ClipTrio's original source code is released under the MIT License.
- Added third-party notices for the FFmpeg, Noto CJK, Node.js, Debian, and browser-WASM distribution boundaries.
- The Docker image now includes ClipTrio's root license and third-party notice.

[1.0.0]: https://github.com/nekohatch/ClipTrio/releases/tag/v1.0.0
