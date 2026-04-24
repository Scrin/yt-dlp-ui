package downloader

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"
)

// VideoInfo represents metadata returned by yt-dlp -j.
type VideoInfo struct {
	ID          string   `json:"id"`
	Title       string   `json:"title"`
	Description string   `json:"description"`
	Thumbnail   string   `json:"thumbnail"`
	Duration    float64  `json:"duration"`
	Uploader    string   `json:"uploader"`
	URL         string   `json:"webpage_url"`
	Formats     []Format `json:"formats"`
}

// PlaylistInfo is a flat-playlist listing returned by `yt-dlp -J --flat-playlist`.
type PlaylistInfo struct {
	ID       string          `json:"id"`
	Title    string          `json:"title"`
	Uploader string          `json:"uploader"`
	Entries  []PlaylistEntry `json:"entries"`
}

// PlaylistEntry is a single video stub within a PlaylistInfo.
type PlaylistEntry struct {
	ID       string  `json:"id"`
	URL      string  `json:"url"`
	Title    string  `json:"title"`
	Duration float64 `json:"duration"`
}

// ResolveResult is the result of resolving a URL: either a single video with
// full formats, or a playlist with stub entries.
type ResolveResult struct {
	Type     string        `json:"type"` // "video" or "playlist"
	Video    *VideoInfo    `json:"video,omitempty"`
	Playlist *PlaylistInfo `json:"playlist,omitempty"`
}

// Format represents a single available format.
type Format struct {
	FormatID    string  `json:"format_id"`
	Ext         string  `json:"ext"`
	Resolution  string  `json:"resolution"`
	Width       int     `json:"width"`
	Height      int     `json:"height"`
	FPS         float64 `json:"fps"`
	VCodec      string  `json:"vcodec"`
	ACodec      string  `json:"acodec"`
	Filesize    int64   `json:"filesize"`
	FilesizeStr string  `json:"filesize_approx_str,omitempty"`
	TBR         float64 `json:"tbr"`
	ABR         float64 `json:"abr"`
	VBR         float64 `json:"vbr"`
	FormatNote  string  `json:"format_note"`
	Protocol    string  `json:"protocol"`
}

// Progress represents a parsed progress update from yt-dlp.
type Progress struct {
	Status          string  `json:"status"`
	DownloadedBytes int64   `json:"downloaded_bytes"`
	TotalBytes      int64   `json:"total_bytes"`
	TotalEstimate   int64   `json:"total_bytes_estimate"`
	Percent         float64 `json:"_percent"` // pre-calculated by yt-dlp
	Speed           float64 `json:"speed"`
	ETA             float64 `json:"eta"`
	Elapsed         float64 `json:"elapsed"`
	Filename        string  `json:"filename"`
	Postprocessor   string  `json:"postprocessor,omitempty"`
}

// YtDlp wraps the yt-dlp CLI.
type YtDlp struct {
	BinaryPath string
}

// NewYtDlp creates a new yt-dlp wrapper.
func NewYtDlp(binaryPath string) *YtDlp {
	return &YtDlp{BinaryPath: binaryPath}
}

// Resolve inspects a URL and returns either a single video (with full format
// list) or a playlist (with flat stub entries, cheap for long playlists).
// mode disambiguates URLs that contain both a video and a playlist (e.g.
// YouTube "watch?v=X&list=Y"): "video" forces single-video, "playlist" forces
// the whole playlist, "" lets yt-dlp apply its own default (playlist).
func (y *YtDlp) Resolve(ctx context.Context, url, mode string) (*ResolveResult, error) {
	args := []string{
		"-J",
		"--flat-playlist",
		"--no-warnings",
		"--color", "never",
	}
	switch mode {
	case "video":
		args = append(args, "--no-playlist")
	case "playlist":
		args = append(args, "--yes-playlist")
	}
	args = append(args, url)
	cmd := exec.CommandContext(ctx, y.BinaryPath, args...)

	out, err := cmd.Output()
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			return nil, fmt.Errorf("yt-dlp error: %s", string(exitErr.Stderr))
		}
		return nil, fmt.Errorf("failed to run yt-dlp: %w", err)
	}

	var peek struct {
		Type string `json:"_type"`
	}
	if err := json.Unmarshal(out, &peek); err != nil {
		return nil, fmt.Errorf("failed to parse yt-dlp output: %w", err)
	}

	if peek.Type == "playlist" || peek.Type == "multi_video" {
		var pl PlaylistInfo
		if err := json.Unmarshal(out, &pl); err != nil {
			return nil, fmt.Errorf("failed to parse playlist: %w", err)
		}
		return &ResolveResult{Type: "playlist", Playlist: &pl}, nil
	}

	var vi VideoInfo
	if err := json.Unmarshal(out, &vi); err != nil {
		return nil, fmt.Errorf("failed to parse video: %w", err)
	}
	return &ResolveResult{Type: "video", Video: &vi}, nil
}

// parseProgressLine attempts to parse a yt-dlp output line as a progress event.
// It handles bare JSON, prefixed JSON (download:/postprocess:), and the default
// text format ("[download]  12.3% of ...").
func parseProgressLine(line string) (Progress, bool) {
	switch {
	case strings.HasPrefix(line, "{"):
		var p Progress
		if json.Unmarshal([]byte(line), &p) == nil {
			return p, true
		}
	case strings.HasPrefix(line, "download:"):
		var p Progress
		if json.Unmarshal([]byte(line[len("download:"):]), &p) == nil {
			return p, true
		}
	case strings.HasPrefix(line, "postprocess:"):
		var p Progress
		if json.Unmarshal([]byte(line[len("postprocess:"):]), &p) == nil {
			return p, true
		}
	case strings.HasPrefix(line, "[download]"):
		// Default text format: "[download]  12.3% of   9.63MiB at   6.55MiB/s ETA 00:01"
		if fields := strings.Fields(line); len(fields) >= 2 {
			if pct, err := strconv.ParseFloat(strings.TrimSuffix(fields[1], "%"), 64); err == nil {
				return Progress{Status: "downloading", Percent: pct}, true
			}
		}
	}
	return Progress{}, false
}

// DownloadResult holds the final filepath and the yt-dlp-reported metadata
// for the resolved format(s), emitted via --print after_move: tagged lines.
type DownloadResult struct {
	Path   string
	Height int
	VCodec string
	ACodec string
	ABR    float64
}

// scanLines reads lines from r, parses progress events and sends them to ch.
// "downloading" events are throttled to at most one per 100ms; all other status
// events (finished, started, etc.) are sent immediately.
// When result != nil, lines matching the strict `<key>=<value>` prefixes
// emitted by our --print after_move: flags are parsed into the struct.
func scanLines(r io.Reader, ch chan<- Progress, result *DownloadResult) {
	const minInterval = 100 * time.Millisecond
	var lastSent time.Time

	scanner := bufio.NewScanner(r)
	for scanner.Scan() {
		// yt-dlp may separate progress updates with \r on some versions.
		// Split so each part is processed individually.
		for part := range strings.SplitSeq(scanner.Text(), "\r") {
			line := strings.TrimSpace(part)
			if line == "" {
				continue
			}
			if p, ok := parseProgressLine(line); ok {
				if p.Status != "downloading" || time.Since(lastSent) >= minInterval {
					ch <- p
					if p.Status == "downloading" {
						lastSent = time.Now()
					}
				}
				continue
			}
			if result != nil {
				parseDownloadResultLine(line, result)
			}
		}
	}
}

// parseDownloadResultLine recognizes the five tagged `--print after_move:`
// outputs emitted by Download and populates the result. Unknown lines are
// ignored (strict prefix match — no heuristic filepath detection).
func parseDownloadResultLine(line string, r *DownloadResult) {
	idx := strings.IndexByte(line, '=')
	if idx <= 0 {
		return
	}
	key, val := line[:idx], line[idx+1:]
	if val == "NA" {
		val = ""
	}
	switch key {
	case "filepath":
		r.Path = val
	case "height":
		if n, err := strconv.Atoi(val); err == nil {
			r.Height = n
		}
	case "vcodec":
		r.VCodec = val
	case "acodec":
		r.ACodec = val
	case "abr":
		if f, err := strconv.ParseFloat(val, 64); err == nil {
			r.ABR = f
		}
	}
}

// downloadOutputTemplate is the yt-dlp -o value used for every download.
// Kept deliberately plain (no quality tag baked in) so that both single-video
// and playlist flows produce the identical pre-rename shape
// `.tmp.<title>_[<id>].<ext>`, which manager.renameWithQualityTag then
// transforms into `<title>_[<id>]_<tag>.<ext>`.
// If you change this template, update renameWithQualityTag and its tests
// (`TestRenameWithQualityTag` in manager_test.go) to match the new shape.
const downloadOutputTemplate = ".tmp.%(title)s_[%(id)s].%(ext)s"

// Download starts a download and sends progress updates to progressCh.
// Returns the final filepath plus yt-dlp-reported format metadata (height,
// vcodec, acodec, abr) so the caller can build a clean filename quality tag
// after merge/post-processing, when the resolved codecs are known.
//
// FormatID is passed to yt-dlp's -f flag unchanged — it may be a specific
// format id ("248+251") for single-video downloads or a selector expression
// ("bv*[vcodec^=vp9]+ba*[acodec^=opus]/b") for playlist downloads. yt-dlp
// treats both uniformly and emits the same post-merge metadata, so the
// filename tag built by the caller is flow-independent by construction.
func (y *YtDlp) Download(ctx context.Context, url, formatID, outputDir string, progressCh chan<- Progress) (*DownloadResult, error) {
	defer close(progressCh)

	args := []string{
		"--color", "never",
		"--newline",
		"--no-warnings",
		"--no-playlist",
		"--progress",
		"--progress-template", "download:%(progress)j",
		"--progress-template", "postprocess:%(progress)j",
		"--restrict-filenames",
		"--no-part",
		"--no-mtime",
		"-P", outputDir,
		"-o", downloadOutputTemplate,
		// Tagged key=value prints; parsed by parseDownloadResultLine.
		"--print", "after_move:filepath=%(filepath)s",
		"--print", "after_move:height=%(height)s",
		"--print", "after_move:vcodec=%(vcodec)s",
		"--print", "after_move:acodec=%(acodec)s",
		"--print", "after_move:abr=%(abr)s",
	}

	if formatID != "" {
		args = append(args, "-f", formatID)
	}

	args = append(args, url)

	cmd := exec.CommandContext(ctx, y.BinaryPath, args...)
	// Disable Python's block buffering so progress lines flush immediately.
	cmd.Env = append(os.Environ(), "PYTHONUNBUFFERED=1")

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("failed to create stdout pipe: %w", err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return nil, fmt.Errorf("failed to create stderr pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("failed to start yt-dlp: %w", err)
	}

	// Scan stderr in a goroutine so stdout is drained concurrently.
	// stderr carries progress only; our tagged prints go to stdout.
	var wg sync.WaitGroup
	wg.Go(func() { scanLines(stderr, progressCh, nil) })

	// Scan stdout for progress events and the tagged metadata prints.
	result := &DownloadResult{}
	scanLines(stdout, progressCh, result)

	// Wait for the stderr goroutine to finish draining before cmd.Wait()
	// closes the pipes. When the process exits its stderr fd is closed,
	// causing EOF on our read pipe and unblocking scanner.Scan().
	wg.Wait()

	if err := cmd.Wait(); err != nil {
		return nil, fmt.Errorf("yt-dlp exited with error: %w", err)
	}

	return result, nil
}
