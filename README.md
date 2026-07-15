# ClipTrio

把 3 个 iPhone Live Photo 导出的 MOV/MP4 拼成可发小红书/抖音的竖版 MP4。

## 纯前端版（ffmpeg.wasm 技术验证）

当前 `feature/ffmpeg-wasm-frontend` 分支提供无需视频渲染后端的版本。三个源视频只在用户浏览器中读取和处理，不会上传到服务器；MP4 由单线程 `ffmpeg.wasm` 编码，PNG 继续由 Canvas 生成。

### 当前能力

- 三个 MOV、MP4 或 M4V 视频的片段选择、循环、居中裁剪和三层拼接。
- 浏览器本地导出 H.264 MP4，固定为 720 × 1280、30fps、yuv420p、faststart 和静音 AAC 音轨。
- 当前预览帧导出 PNG，仍支持 1080 × 1920 和 720 × 1280。
- 字幕先由 Canvas 生成透明覆盖层，再参与最终视频编码，以保持预览和输出的一致性。
- 导出过程显示阶段和进度，支持取消；失败或取消不会清空已选择的素材和参数。
- 记录本次导出的总耗时，以及浏览器可提供时的 JS 堆峰值估算。

1080p 和 60fps MP4 在技术验证阶段暂不开放。显示的内存数据不包含全部 WASM Worker、解码缓冲区或浏览器进程内存，不能作为系统总内存峰值。

### 本地启动

```bash
npm run start:wasm
```

打开：

```text
http://127.0.0.1:4173/
```

这是独立的纯静态服务，不提供 `/api/*` 接口，也不要求本机安装 FFmpeg。不要直接通过 `file://` 打开 `public/index.html`，否则 ES Module、Worker 或 WASM 可能因浏览器安全策略而无法加载。

如需修改默认端口：

```powershell
$env:STATIC_PORT='4174'
npm run start:wasm
```

### 安装与更新 WASM 资源

项目将浏览器运行所需资源自托管在 `public/vendor/`，运行时不依赖第三方 CDN。更新依赖或重新生成该目录时运行：

```bash
npm install
npm run vendor:ffmpeg
```

`@ffmpeg/core` 的 WASM 文件约 32MB，首次导出需要先加载。它以 GPL-2.0-or-later 发布，分发说明见 [`public/THIRD_PARTY_NOTICES.md`](./public/THIRD_PARTY_NOTICES.md)。完整实现、验证步骤和性能指标限制见 [`BROWSER_WASM_PROTOTYPE.md`](./BROWSER_WASM_PROTOTYPE.md)。

### GitHub Pages

纯前端版的运行文件全部位于 `public/`，可以通过 GitHub Actions 发布到 GitHub Pages。部署时必须保持目录结构，并确保 `ffmpeg-core.wasm` 以 `application/wasm` 返回。当前仓库尚未添加 Pages 发布工作流。

## 原后端版（原生 FFmpeg）

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
