import {
  CAPTION_GRADIENT_START,
  CANVAS_CAPTION_GRADIENT_END_OPACITY,
  CANVAS_CAPTION_GRADIENT_MID_OPACITY,
  CANVAS_CAPTION_GRADIENT_MIDPOINT,
  getCanvasCaptionMetrics,
  getCoverRect,
  getSectionRects,
  getOutputGeometry
} from './composition-core.js';

export function configureOutputCanvas(canvas, resolution) {
  const geometry = getOutputGeometry(resolution);
  canvas.width = geometry.width;
  canvas.height = geometry.height;
  return geometry;
}

export function drawCover(ctx, source, rect) {
  const drawRect = getCoverRect(source.videoWidth, source.videoHeight, rect);
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.width, rect.height);
  ctx.clip();
  ctx.drawImage(source, drawRect.x, drawRect.y, drawRect.width, drawRect.height);
  ctx.restore();
}

export function drawCaption(ctx, text, rect) {
  if (!text) return;
  const { fontSize, baselineOffset } = getCanvasCaptionMetrics(rect.height);
  const gradientY = rect.y + rect.height * CAPTION_GRADIENT_START;
  const gradientHeight = rect.height * (1 - CAPTION_GRADIENT_START);
  const gradient = ctx.createLinearGradient(0, gradientY, 0, rect.y + rect.height);
  gradient.addColorStop(0, 'rgba(0,0,0,0)');
  gradient.addColorStop(CANVAS_CAPTION_GRADIENT_MIDPOINT, `rgba(0,0,0,${CANVAS_CAPTION_GRADIENT_MID_OPACITY})`);
  gradient.addColorStop(1, `rgba(0,0,0,${CANVAS_CAPTION_GRADIENT_END_OPACITY})`);
  ctx.fillStyle = gradient;
  ctx.fillRect(rect.x, gradientY, rect.width, gradientHeight);
  ctx.save();
  ctx.textAlign = 'center';
  ctx.font = `500 ${fontSize}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  ctx.shadowColor = 'rgba(0,0,0,0.58)';
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 4;
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.fillText(text, rect.x + rect.width / 2, rect.y + rect.height - baselineOffset);
  ctx.restore();
}

export function drawCaptionOverlay(canvas, ctx, captions, resolution) {
  const geometry = configureOutputCanvas(canvas, resolution);
  ctx.clearRect(0, 0, geometry.width, geometry.height);
  getSectionRects(resolution).forEach((rect, index) => {
    drawCaption(ctx, captions[index], rect);
  });
  return geometry;
}

export function drawPlaceholder(canvas, ctx, resolution) {
  const geometry = configureOutputCanvas(canvas, resolution);
  ctx.fillStyle = '#fffefd';
  ctx.fillRect(0, 0, geometry.width, geometry.height);
  ctx.fillStyle = '#f1edeb';
  getSectionRects(resolution).forEach(rect => {
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height - 2);
  });
  ctx.fillStyle = '#201d1b';
  ctx.textAlign = 'center';
  ctx.font = `760 ${Math.round(54 * geometry.scale)}px system-ui, sans-serif`;
  ctx.fillText('选择 3 个 MOV/MP4 视频', geometry.width / 2, geometry.height / 2 - 28 * geometry.scale);
  ctx.fillStyle = '#6f6864';
  ctx.font = `${Math.round(30 * geometry.scale)}px system-ui, sans-serif`;
  ctx.fillText('生成可发布的竖版三拼 MP4', geometry.width / 2, geometry.height / 2 + 34 * geometry.scale);
}

export function drawComposition(canvas, ctx, { slots, captions, labels, resolution }) {
  const geometry = configureOutputCanvas(canvas, resolution);
  ctx.fillStyle = '#201d1b';
  ctx.fillRect(0, 0, geometry.width, geometry.height);
  getSectionRects(resolution).forEach((rect, index) => {
    const slot = slots[index];
    if (slot?.video && slot.duration) {
      drawCover(ctx, slot.video, rect);
      drawCaption(ctx, captions[index], rect);
      return;
    }
    ctx.fillStyle = '#f1edeb';
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    ctx.fillStyle = '#6f6864';
    ctx.textAlign = 'center';
    ctx.font = `700 ${Math.round(30 * geometry.scale)}px system-ui, sans-serif`;
    ctx.fillText(`选择${labels[index]}方视频`, geometry.width / 2, rect.y + rect.height / 2 + 10 * geometry.scale);
  });
}
