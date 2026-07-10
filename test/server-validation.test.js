import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildProxyResponseHeaders,
  collectRenderParts,
  getPublicRenderError,
  labels,
  maxVideoBytes,
  RenderRequestError,
  validateRenderFiles,
  validateVideoDuration,
  validateVideoExtension,
  validateVideoSize
} from '../server-core.js';

function filePart(name, filename, size = 4) {
  return {
    name,
    filename,
    contentType: 'video/mp4',
    data: Buffer.alloc(size)
  };
}

function fieldPart(name, value) {
  return {
    name,
    filename: '',
    contentType: '',
    data: Buffer.from(String(value))
  };
}

test('validateVideoExtension accepts only MOV, MP4, and M4V', () => {
  assert.equal(validateVideoExtension('clip.MOV'), '.mov');
  assert.equal(validateVideoExtension('clip.mp4'), '.mp4');
  assert.equal(validateVideoExtension('clip.m4v'), '.m4v');
  assert.throws(() => validateVideoExtension('clip.avi'), RenderRequestError);
  assert.throws(() => validateVideoExtension('clip'), /Only MOV, MP4, and M4V/);
});

test('validateVideoSize rejects files over the per-video limit', () => {
  assert.doesNotThrow(() => validateVideoSize(maxVideoBytes));
  assert.throws(() => validateVideoSize(maxVideoBytes + 1), /Each video must be 120MB or smaller/);
});

test('validateRenderFiles requires all three slots', () => {
  assert.doesNotThrow(() => validateRenderFiles([{ path: 'a' }, { path: 'b' }, { path: 'c' }]));
  assert.throws(() => validateRenderFiles([{ path: 'a' }, null, { path: 'c' }]), /top, middle, and bottom/);
  assert.deepEqual(labels, ['top', 'middle', 'bottom']);
});

test('validateVideoDuration rejects videos over the duration limit', () => {
  assert.doesNotThrow(() => validateVideoDuration({ filename: 'a.mp4' }, 30));
  assert.throws(() => validateVideoDuration({ filename: 'a.mp4' }, 30.1), /Max duration is 30s/);
});

test('collectRenderParts maps multipart fields and files by slot', () => {
  const result = collectRenderParts([
    fieldPart('clipLength', '3'),
    fieldPart('caption0', 'top'),
    filePart('bottom', 'bottom.m4v'),
    filePart('top', 'top.mp4'),
    filePart('middle', 'middle.mov'),
    filePart('ignored', 'ignored.mp4')
  ]);

  assert.equal(result.fields.clipLength, '3');
  assert.equal(result.fields.caption0, 'top');
  assert.equal(result.files[0].filename, 'top.mp4');
  assert.equal(result.files[1].filename, 'middle.mov');
  assert.equal(result.files[2].filename, 'bottom.m4v');
  assert.equal(result.files.filter(Boolean).length, 3);
});

test('collectRenderParts rejects invalid render requests before files are written', () => {
  assert.throws(() => collectRenderParts([
    filePart('top', 'top.mp4'),
    filePart('middle', 'middle.mov')
  ]), /top, middle, and bottom/);

  assert.throws(() => collectRenderParts([
    filePart('top', 'top.txt'),
    filePart('middle', 'middle.mov'),
    filePart('bottom', 'bottom.mp4')
  ]), /Only MOV, MP4, and M4V/);

  assert.throws(() => collectRenderParts([
    filePart('top', 'top.mp4', maxVideoBytes + 1),
    filePart('middle', 'middle.mov'),
    filePart('bottom', 'bottom.mp4')
  ]), /Each video must be 120MB or smaller/);
});

test('getPublicRenderError maps infrastructure errors to user-facing responses', () => {
  assert.deepEqual(getPublicRenderError(Object.assign(new Error('spawn ffmpeg ENOENT'), { code: 'ENOENT' })), {
    status: 500,
    message: '当前服务找不到 FFmpeg/FFprobe，无法导出 MP4。请使用 Docker 版服务，或安装 FFmpeg 并设置 FFMPEG_PATH/FFPROBE_PATH 后重启服务。'
  });

  assert.deepEqual(getPublicRenderError(Object.assign(new Error('slow'), { code: 'ETIMEDOUT' })), {
    status: 504,
    message: '视频处理超时，请缩短片段或稍后重试。'
  });

  assert.deepEqual(getPublicRenderError(new RenderRequestError('Bad input', 422)), {
    status: 422,
    message: 'Bad input'
  });
});

test('buildProxyResponseHeaders preserves important upstream render headers', () => {
  const headers = new Headers({
    'content-type': 'video/mp4',
    'cache-control': 'no-store',
    'content-disposition': 'attachment; filename="clip.mp4"'
  });

  assert.deepEqual(buildProxyResponseHeaders(headers, 1234), {
    'content-type': 'video/mp4',
    'content-length': 1234,
    'cache-control': 'no-store',
    'content-disposition': 'attachment; filename="clip.mp4"'
  });
});

test('buildProxyResponseHeaders falls back to safe defaults', () => {
  assert.deepEqual(buildProxyResponseHeaders(new Headers(), 42), {
    'content-type': 'application/octet-stream',
    'content-length': 42,
    'cache-control': 'no-store'
  });
});
