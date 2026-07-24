# Third-Party Notices

ClipTrio's original source code is licensed under the MIT License in
[`LICENSE`](./LICENSE). That license does not replace or modify the licenses of
third-party software used with ClipTrio.

## PC server runtime

ClipTrio invokes FFmpeg and FFprobe as separate command-line programs. Local
installations may provide them through `FFMPEG_PATH` and `FFPROBE_PATH`; their
licenses are determined by the binaries selected by the operator.

The supplied `Dockerfile` builds on `node:20-bookworm-slim` and installs Debian
packages including:

- `ffmpeg`
- `fonts-noto-cjk`
- `ca-certificates`

The container therefore contains third-party components under their own
licenses. Debian package copyright and license records remain available inside
the built image under `/usr/share/doc/*/copyright`.

### FFmpeg

FFmpeg is generally available under LGPL-2.1-or-later, but a build that enables
GPL components is distributed under GPL-2.0-or-later. The Debian Bookworm
FFmpeg build verified for the ClipTrio v1.0.0 release enables GPL components,
including `libx264` and `libx265`.

- Project and license information: <https://ffmpeg.org/legal.html>
- Debian source package: <https://sources.debian.org/src/ffmpeg/>
- Debian copyright record in the image: `/usr/share/doc/ffmpeg/copyright`

### Noto CJK fonts

The Docker image installs Debian's `fonts-noto-cjk` package for caption
rendering. Noto fonts are distributed under the SIL Open Font License 1.1.

- Upstream repository: <https://github.com/notofonts/noto-cjk>
- License: <https://openfontlicense.org/open-font-license-official-text/>
- Debian copyright record in the image:
  `/usr/share/doc/fonts-noto-cjk/copyright`

### Node.js and Debian base image

The production image derives from the official Node.js Docker image and Debian
Bookworm. Node.js and the Debian packages included in the base image retain
their respective licenses and copyright notices.

- Node.js license information: <https://github.com/nodejs/node/blob/main/LICENSE>
- Official Node.js image: <https://hub.docker.com/_/node>
- Debian copyright records in the image: `/usr/share/doc/*/copyright`

## Browser-only WASM preview

The browser-only ffmpeg.wasm preview is developed on
`feature/ffmpeg-wasm-frontend` and is not part of the PC server `v1.0.0`
release. Its static distribution has an additional
`public/THIRD_PARTY_NOTICES.md` covering the bundled `@ffmpeg/ffmpeg` wrapper
and `@ffmpeg/core` WebAssembly artifacts. Distributors must preserve that
notice and meet the corresponding-source requirements of the exact Core build.

## Redistributing container images

This repository distributes build instructions, not a prebuilt container
image. Anyone publishing a prebuilt ClipTrio image should:

1. Record the immutable base-image digest and exact installed package versions.
2. Preserve the license and copyright files included by Debian.
3. Make the corresponding source for GPL/LGPL components available using a
   method permitted by the applicable license.
4. Include this notice and ClipTrio's MIT `LICENSE` in the distribution.
5. Review codec patent and deployment requirements for the countries where the
   image or service is distributed.

This notice is provided for attribution and release hygiene and is not legal
advice.
