# yt-dlp-ui

A web UI for downloading video and audio files, powered by [yt-dlp](https://github.com/yt-dlp/yt-dlp).

# Q&A?

Q: Does this support ..?
A: You probably want to use [tubearchivist](https://github.com/tubearchivist/tubearchivist) instead

Q: But I only need to ..
A: You probably want to use [yt-dlp](https://github.com/yt-dlp/yt-dlp) directly instead

Q: So, why?
A: I am lazy, and I didn't want to bother with downloading/installing yt-dlp to whatever device I was using at the time to download whatever one-off video file every now and then. I was looking at existing solutions like the tubearchivist, but it's way overkill for my needs, and as such requires way too much resources, as my server capacity is limited at the moment. Therefore I decided to create this. This uses practically 0% cpu and approximately 2-3MB of RAM when idling.

## Features

- Paste a URL to fetch available formats (resolution, codec, file size)
- Full format picker — choose exactly what quality/format to download
- List and download completed files
- Single binary/image distribution with embedded web UI

## Quick Start (Docker)

```bash
docker build -t yt-dlp-ui .
docker run -p 8080:8080 -v yt-dlp-downloads:/downloads yt-dlp-ui
```

Open http://localhost:8080

## Development

### Prerequisites

- Go 1.22+
- Node.js 22+
- yt-dlp installed locally (for testing downloads)
- ffmpeg (for format merging)

### Running locally

Start the Go backend (dev mode — no embedded frontend):

```bash
go run -tags dev ./cmd/yt-dlp-ui
```

In a separate terminal, start the Vite dev server:

```bash
cd web
npm install
npm run dev
```

Open http://localhost:5173 — the Vite dev server proxies `/api` and `/files` requests to the Go backend on port 8080.

### Building

Build the frontend, then the Go binary:

```bash
cd web && npm ci && npm run build && cd ..
go build -trimpath -ldflags="-s -w" -o yt-dlp-ui ./cmd/yt-dlp-ui
```

## Configuration

All configuration is via environment variables:

| Variable         | Default       | Description                    |
| ---------------- | ------------- | ------------------------------ |
| `PORT`           | `8080`        | Server listen port             |
| `DOWNLOAD_DIR`   | `./downloads` | Directory for downloaded files |
| `MAX_CONCURRENT` | `2`           | Maximum parallel downloads     |
| `YT_DLP_PATH`    | `yt-dlp`      | Path to yt-dlp binary          |
