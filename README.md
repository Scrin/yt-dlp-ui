# yt-dlp-ui

A small web UI for downloading video and audio files, powered by
[yt-dlp](https://github.com/yt-dlp/yt-dlp).

Paste a URL, pick a format, get a file. Works for single videos, entire
playlists, and YouTube Mix/Radio URLs. Ships as a single ~15 MB static
binary (or Docker image) and uses ~2–3 MB of RAM at idle.

![ci](https://github.com/Scrin/yt-dlp-ui/actions/workflows/ci.yml/badge.svg)

## Q&A

**Q: Does this support X?**

A: You probably want to use
[tubearchivist](https://github.com/tubearchivist/tubearchivist) instead.

**Q: But I only need to Y.**

A: You probably want to use
[yt-dlp](https://github.com/yt-dlp/yt-dlp) directly instead.

**Q: So, why?**

A: Laziness. I didn't want to bother installing yt-dlp on whatever device
I happened to be using to download some one-off video. Existing solutions
like tubearchivist were overkill for my needs and wanted more server
capacity than I had. This one uses practically 0% CPU and ~2–3 MB of RAM
when idling, which fits comfortably on the tiny VPS I had available.

## Features

- **Single-video downloads** with a format picker — select one video stream,
  one audio stream, or both; yt-dlp merges them via ffmpeg.
- **Playlist downloads** — fan out into per-video jobs with a codec-preference
  profile (VP9+Opus, AV1+Opus, H.264+AAC, best-available) or a custom yt-dlp
  format selector. Entries dedupe automatically (YouTube Mix playlists often
  repeat videos).
- **"Already downloaded" indicators** — the format picker and playlist picker
  both scan the downloads directory for the video's id and show you what you
  already have at what quality. Playlist re-runs default-select only the
  entries that are new.
- **Ambiguous URLs handled explicitly** — pasting a URL that contains both a
  video and a playlist (e.g. YouTube's `watch?v=X&list=Y`) presents two
  buttons so you pick whether to fetch the single video or the whole list.
- **Concurrent download queue** with live progress streamed over Server-Sent
  Events. Configurable parallelism.
- **Cancel** queued or running downloads mid-flight.
- **File browser** — list, download, and delete completed files from the
  browser. Deletions also remove the corresponding job entry.
- **Single-binary / single-image deployment** with the web UI embedded; no
  separate static-file server needed.

## Filename format

Downloads are written as:

```
<title>_[<id>]_<tag>.<ext>
```

- `<title>` — yt-dlp-sanitised video title (`--restrict-filenames`).
- `<id>` — the source's video id, always in square brackets. Handy for
  grepping the directory regardless of title.
- `<tag>` — one of:
  - `<height>p_<vcodec>_<acodec>` for merged video+audio (e.g.
    `1080p_vp9_opus`, `1080p_h264_aac`, `2160p_av01_opus`).
  - `<height>p_<vcodec>` for video without audio.
  - `<abr>kbps_<acodec>` for audio-only (e.g. `128kbps_opus`).
- `<ext>` — container chosen by yt-dlp.

Codec names are normalised to short friendly forms regardless of how yt-dlp
reports them (`avc1.640028` → `h264`, `mp4a.40.2` → `aac`,
`vp09.00.41.08` → `vp9`, `av01.0.08M.08` → `av01`, `hev1.1.6.*` → `h265`).
This is an intentional contract, enforced by Go tests in
`internal/downloader/manager_test.go`. If you fork and change the tag shape,
those tests will fail loudly.

The tag is inserted *after* the download completes from yt-dlp's
`--print after_move:` output, so single-video and playlist flows produce
identical filenames for identical content.

## Quick start (Docker)

A prebuilt multi-arch image is published on GHCR:

```bash
docker run -d \
  --name yt-dlp-ui \
  -p 8080:8080 \
  -v yt-dlp-downloads:/downloads \
  ghcr.io/scrin/yt-dlp-ui
```

Open http://localhost:8080.

Downloaded files live in the `yt-dlp-downloads` named volume (mounted at
`/downloads` inside the container). Swap it for a bind mount such as
`-v /path/on/host:/downloads` to write directly to the host filesystem.

## Configuration

All configuration is via environment variables:

| Variable         | Default       | Description                                          |
| ---------------- | ------------- | ---------------------------------------------------- |
| `PORT`           | `8080`        | Server listen port.                                  |
| `DOWNLOAD_DIR`   | `./downloads` | Directory for downloaded files.                      |
| `MAX_CONCURRENT` | `2`           | Maximum parallel downloads (worker pool size).       |
| `YT_DLP_PATH`    | `yt-dlp`      | Path or name of the yt-dlp binary.                   |

In the container image, `DOWNLOAD_DIR` defaults to `/downloads` and `PORT`
to `8080`.

## Playlist download profiles

When the pasted URL resolves to a playlist, the picker offers these codec
preferences. Each maps to a yt-dlp `-f` expression that's passed verbatim.

| Profile                           | Selector                                                    |
| --------------------------------- | ----------------------------------------------------------- |
| VP9 + Opus (best for YouTube)     | `bv[vcodec^=vp9]+ba[acodec^=opus]/bv*+ba*/b`                |
| AV1 + Opus (smaller, newer)       | `bv[vcodec^=av01]+ba[acodec^=opus]/bv*+ba*/b`               |
| H.264 + AAC (mp4 compatibility)   | `bv[vcodec^=avc1]+ba[acodec^=mp4a]/b[ext=mp4]/b`            |
| Best available (any codec)        | `bv*+ba*/b`                                                 |
| Audio only — Opus                 | `ba*[acodec^=opus]/ba*/b`                                   |
| Audio only — AAC/m4a              | `ba*[ext=m4a]/ba*/b`                                        |

An "Advanced" section lets you paste an arbitrary yt-dlp format selector
for cases the profiles don't cover.

## Development

### Prerequisites

- Go 1.25+
- Node.js 22+
- `yt-dlp` installed and on `PATH` (or point `YT_DLP_PATH` at it)
- `ffmpeg` on `PATH` (yt-dlp needs it to merge video+audio streams)

### Running locally

Start the Go backend in dev mode (frontend is not embedded; Vite serves it):

```bash
go run -tags dev ./cmd/yt-dlp-ui
```

In a separate terminal, start the Vite dev server:

```bash
cd web
npm install
npm run dev
```

Open http://localhost:5173 — the Vite dev server proxies `/api` and
`/files` requests to the Go backend on port 8080.

### Tests and linting

```bash
go test -tags dev ./...
go vet -tags dev ./...
cd web && npm run lint && npm run build
```

`go test` runs the filename-contract tests that lock the
`<height>p_<vcodec>_<acodec>` shape, codec normalisation, and the
`.tmp.*` → final-name rename. CI runs these on every push and pull request.

The `-tags dev` selects `web/embed_dev.go` over `web/embed.go`, skipping the
`//go:embed dist/*` directive so you don't need to build the frontend just
to run the Go tests. The real embed is exercised when you build for
production (either `npm run build && go build` or `docker build`).

### Building

Build the frontend, then the Go binary:

```bash
cd web && npm ci && npm run build && cd ..
go build -trimpath -ldflags="-s -w" -o yt-dlp-ui ./cmd/yt-dlp-ui
```

Or build the container image yourself:

```bash
docker build -t yt-dlp-ui .
```

## Architecture

The project is deliberately tiny. One Go backend, one React (TypeScript +
Tailwind) frontend, no database, no background workers outside of the Go
process itself.

```
cmd/yt-dlp-ui/           main — wires config, manager, Gin router, graceful shutdown
internal/config/         environment-variable parsing
internal/api/            Gin handlers + Server-Sent Events stream
internal/downloader/     yt-dlp wrapper, job manager, filename contract
web/                     React SPA (Vite), embedded into the Go binary via //go:embed
```

Key invariants:

- **One filename codepath.** Both single-video and playlist downloads go
  through `ytdlp.Download` → `buildQualityTag` → `renameWithQualityTag` with
  the same metadata shape (from yt-dlp's `--print after_move:` output). Do
  not branch on flow type when naming files; fix the codec normaliser
  instead. `manager_test.go` pins this contract.
- **`format_id` is an opaque string.** The frontend constructs either a
  specific pair (`"248+251"`) or a selector expression
  (`"bv[vcodec^=vp9]+ba[acodec^=opus]/…"`) and the backend passes it
  straight to `yt-dlp -f`. No parsing on the Go side.
- **Progress is streamed, not polled.** `/api/events` is a Server-Sent Events
  endpoint; the frontend maintains a `Map<id, Job>` updated in place. New
  subscribers receive the full current state as `job:init` events on connect.
- **Jobs stay in memory for 1 hour after completion**, then get evicted by
  a background cleanup loop. There is no persistence — restart clears all
  job history. Files on disk are the only long-term state.

## License

Not yet licensed. If you plan to use this seriously, open an issue and ask.
