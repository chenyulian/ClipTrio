# Live Triptych

把 3 个 iPhone Live Photo 导出的 MOV/MP4 拼成可发小红书/抖音的竖版 MP4。

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
- 1080 x 1920
- 30fps
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
