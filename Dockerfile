FROM node:22-bookworm-slim

# ffmpeg + python3/pip (for yt-dlp) + curl
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    python3 \
    python3-pip \
    curl \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Install yt-dlp as a standalone binary (avoids pip/venv headaches)
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
  && chmod a+rx /usr/local/bin/yt-dlp

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

# Render provides PORT; app must bind 0.0.0.0
ENV HOST=0.0.0.0
ENV ALLOW_REMOTE=true
ENV DOWNLOAD_DIR=/data/downloads
ENV DB_PATH=/data/clipmate.db
ENV TEMP_DIR=/data/tmp

RUN mkdir -p /data/downloads /data/tmp

EXPOSE 3000

CMD ["node", "server/index.js"]
