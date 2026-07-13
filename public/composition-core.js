// Shared composition geometry and caption parameters for browser Canvas and
// server-side FFmpeg rendering. Keep this module dependency-free so Node tests
// can verify the export contract without a browser or build step.

export const OUTPUT_WIDTH = 1080;
export const OUTPUT_HEIGHT = 1920;
export const SECTION_COUNT = 3;
export const SECTION_HEIGHT = 640;
export const OUTPUT_FPS = 30;

export const CAPTION_GRADIENT_START = 0.58;

// Canvas keeps the existing two-stop easing and system font rendering.
export const CANVAS_CAPTION_GRADIENT_MIDPOINT = 0.55;
export const CANVAS_CAPTION_GRADIENT_MID_OPACITY = 0.26;
export const CANVAS_CAPTION_GRADIENT_END_OPACITY = 0.58;
export const CANVAS_CAPTION_BASELINE_RATIO = 0.075;
export const CANVAS_CAPTION_BASELINE_MIN_OFFSET = 38;
export const CANVAS_CAPTION_FONT_RATIO = 0.058;
export const CANVAS_CAPTION_FONT_MIN = 24;
export const CANVAS_CAPTION_FONT_MAX = 38;

// FFmpeg uses Noto CJK and positions drawtext from the glyph box top.
export const FFMPEG_CAPTION_FONT_SIZE = 34;
export const FFMPEG_CAPTION_TOP_OFFSET = 72;
export const FFMPEG_CAPTION_FONT_OPACITY = 0.92;
export const FFMPEG_GRADIENT_BASE_OPACITY = 0.012;
export const FFMPEG_GRADIENT_OPACITY_RANGE = 0.34;
export const FFMPEG_GRADIENT_EXPONENT = 1.85;

export function getSectionRects() {
  return Array.from({ length: SECTION_COUNT }, (_, index) => ({
    x: 0,
    y: index * SECTION_HEIGHT,
    width: OUTPUT_WIDTH,
    height: SECTION_HEIGHT
  }));
}

export function getCoverRect(sourceWidth, sourceHeight, targetRect) {
  const safeWidth = Math.max(1, Number(sourceWidth) || 1);
  const safeHeight = Math.max(1, Number(sourceHeight) || 1);
  const scale = Math.max(targetRect.width / safeWidth, targetRect.height / safeHeight);
  const width = safeWidth * scale;
  const height = safeHeight * scale;
  return {
    x: targetRect.x + (targetRect.width - width) / 2,
    y: targetRect.y + (targetRect.height - height) / 2,
    width,
    height
  };
}

export function getCanvasCaptionMetrics(sectionHeight = SECTION_HEIGHT) {
  const height = Math.max(1, Number(sectionHeight) || SECTION_HEIGHT);
  const fontSize = Math.max(
    CANVAS_CAPTION_FONT_MIN,
    Math.min(CANVAS_CAPTION_FONT_MAX, Math.round(height * CANVAS_CAPTION_FONT_RATIO))
  );
  const baselineOffset = Math.max(CANVAS_CAPTION_BASELINE_MIN_OFFSET, height * CANVAS_CAPTION_BASELINE_RATIO);
  return { fontSize, baselineOffset };
}

export function getFfmpegCaptionYExpression() {
  return `h-${FFMPEG_CAPTION_TOP_OFFSET}`;
}
