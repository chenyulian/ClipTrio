# ClipTrio

视频 3 拼工具，可添加字幕，导出为视频或图片。

## 版本说明

`v1.0.0` 是 PC Web 服务端渲染版的首个稳定版本。它使用原生 FFmpeg 导出 MP4，并使用浏览器 Canvas 导出当前预览帧的 PNG。

WASM 纯前端版目前仍是独立技术预览，代码位于 `feature/ffmpeg-wasm-frontend` 分支，不属于 `v1.0.0` 的发布内容。它可以在线体验：

在线地址：[https://nekohatch.github.io/ClipTrio/public/](https://nekohatch.github.io/ClipTrio/public/)

WASM 版使用 `ffmpeg.wasm` 在浏览器本地完成视频处理，三个源视频不会上传到服务器，也不需要部署渲染后端。当前视频固定导出为 720 × 1280、30fps 的 H.264 MP4；图片仍由 Canvas 根据当前预览帧生成。

需要注意：WASM 版首次导出需要加载约 32MB 的编码核心，而且浏览器本地编码通常明显慢于服务器原生 FFmpeg。它更适合重视隐私、无需后端或临时体验的场景；如果更看重导出速度和稳定性，推荐使用服务器部署版。

## PC 服务端版

### 本地运行

```bash
npm start
```

本地需要安装 FFmpeg，或设置 `FFMPEG_PATH` 指向 FFmpeg 可执行文件。

### Docker 部署

```bash
docker compose up -d --build
```

打开：

```text
http://服务器IP:3000
```

### 输出规格

- 视频：H.264 MP4，1080 × 1920 或 720 × 1280，30fps 或 60fps，yuv420p，静音 AAC 音轨，faststart。
- 图片：当前预览帧生成的 PNG，1080 × 1920 或 720 × 1280。
- 三个连续等高区域，无间隙，居中 cover 裁切，可选底部居中字幕。

### 输入限制

- 必须上传 3 个视频。
- 支持 `.mov`、`.mp4`、`.m4v`。
- 单个视频最大 120MB。
- 单个视频最长 30 秒。
- 3 个视频总上传体积最大约 380MB。
- 片段循环最长 8 秒。
- 导出视频最长 10 秒。

### 使用方式

1. 上传 3 个 MOV/MP4/M4V。
2. 调整每个视频的片段起点和循环长度。
3. 填写每格字幕水印，可留空。
4. 选择 MP4 或 PNG 模式并导出。

## 开发与发布验证

运行语法检查和全部 Node 测试：

```bash
npm run verify:release
```

真实 MP4 导出验证需要 Docker 渲染服务和本地代理，完整步骤见 [`RENDER_SMOKE_TEST.md`](./RENDER_SMOKE_TEST.md)。版本范围和发布记录见 [`CHANGELOG.md`](./CHANGELOG.md)，正式发布前按 [`RELEASE_CHECKLIST.md`](./RELEASE_CHECKLIST.md) 完成验收。

公开部署服务端版本前，还应配置访问控制、请求频率限制，并完成渲染并发与有界队列保护；`v1.0.0` 本身不承诺面向不受信任用户的多租户托管能力。

## 许可证

ClipTrio 自身代码使用 [MIT License](./LICENSE)，版权所有 © 2026 nekohatch。

FFmpeg、Noto CJK 字体、Node.js、Debian 组件及 WASM 技术预览中的依赖保留各自许可证。使用或分发 Docker 镜像、FFmpeg 二进制或 WASM Core 前，请阅读 [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md) 以及对应发行物内的第三方声明。
