# ClipTrio

视频 3 拼工具，可添加字幕，导出为视频或图片。

## WASM 纯前端在线版

在线地址：[https://chenyulian.github.io/ClipTrio/public/](https://chenyulian.github.io/ClipTrio/public/)

WASM 版使用 `ffmpeg.wasm` 在浏览器本地完成视频处理，三个源视频不会上传到服务器，也不需要部署渲染后端。当前视频固定导出为 720 × 1280、30fps 的 H.264 MP4；图片仍由 Canvas 根据当前预览帧生成。

需要注意：WASM 版首次导出需要加载约 32MB 的编码核心，而且浏览器本地编码通常明显慢于服务器原生 FFmpeg。它更适合重视隐私、无需后端或临时体验的场景；如果更看重导出速度和稳定性，推荐使用服务器部署版。

## 本地运行

```bash
npm start
```

本地需要安装 FFmpeg，或设置 `FFMPEG_PATH` 指向 FFmpeg 可执行文件。

## Docker 部署

```bash
docker compose up -d --build
```

打开：

```text
http://服务器IP:3000
```

## 输出规格

- MP4
- H.264
- 1080 x 1920 or 720 x 1280
- 30fps or 60fps
- yuv420p
- 静音 AAC 音轨
- faststart

## 输入限制

- 必须上传 3 个视频。
- 支持 `.mov`、`.mp4`、`.m4v`。
- 单个视频最大 120MB。
- 单个视频最长 30 秒。
- 3 个视频总上传体积最大约 380MB。
- 片段循环最长 8 秒。
- 导出视频最长 10 秒。

## 使用方式

1. 上传 3 个 MOV/MP4/M4V。
2. 调整每个视频起点。
3. 填写每格字幕水印，可留空。
4. 点击“导出 MP4”。
