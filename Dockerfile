ARG NODE_IMAGE=node:20-bookworm-slim
FROM ${NODE_IMAGE}

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg fonts-noto-cjk ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
COPY server.js server-core.js server-process.js ./
COPY public ./public

ENV NODE_ENV=production
ENV PORT=3000
ENV FFMPEG_PATH=ffmpeg
ENV FFPROBE_PATH=ffprobe

EXPOSE 3000
CMD ["node", "server.js"]
