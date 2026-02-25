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

// FetchFormats retrieves available formats for a URL.
func (y *YtDlp) FetchFormats(ctx context.Context, url string) (*VideoInfo, error) {
	cmd := exec.CommandContext(ctx, y.BinaryPath,
		"-j",
		"--no-warnings",
		"--color", "never",
		url,
	)

	out, err := cmd.Output()
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			return nil, fmt.Errorf("yt-dlp error: %s", string(exitErr.Stderr))
		}
		return nil, fmt.Errorf("failed to run yt-dlp: %w", err)
	}

	var info VideoInfo
	if err := json.Unmarshal(out, &info); err != nil {
		return nil, fmt.Errorf("failed to parse yt-dlp output: %w", err)
	}
	return &info, nil
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

// scanLines reads lines from r, parses progress events and sends them to ch.
// "downloading" events are throttled to at most one per 100ms; all other status
// events (finished, started, etc.) are sent immediately.
// If extractPath is true, any non-info line that is not a progress event is
// recorded as the final filepath (from --print after_move:filepath) and returned.
func scanLines(r io.Reader, ch chan<- Progress, extractPath bool) string {
	const minInterval = 100 * time.Millisecond
	var finalPath string
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
			// Non-progress, non-info line: filepath from --print after_move:filepath.
			if extractPath && !strings.HasPrefix(line, "[") {
				finalPath = line
			}
		}
	}
	return finalPath
}

// Download starts a download and sends progress updates to progressCh.
// Returns the final filepath of the downloaded file.
func (y *YtDlp) Download(ctx context.Context, url, formatID, outputDir, qualityTag string, progressCh chan<- Progress) (string, error) {
	defer close(progressCh)

	args := []string{
		"--color", "never",
		"--newline",
		"--no-warnings",
		"--progress",
		"--progress-template", "download:%(progress)j",
		"--progress-template", "postprocess:%(progress)j",
		"--restrict-filenames",
		"--no-part",
		"--no-mtime",
		"-P", outputDir,
		"-o", ".tmp.%(title)s_[%(id)s]_" + qualityTag + ".%(ext)s",
		"--print", "after_move:filepath",
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
		return "", fmt.Errorf("failed to create stdout pipe: %w", err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return "", fmt.Errorf("failed to create stderr pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		return "", fmt.Errorf("failed to start yt-dlp: %w", err)
	}

	// Scan stderr in a goroutine so stdout is drained concurrently.
	var wg sync.WaitGroup
	wg.Go(func() { scanLines(stderr, progressCh, false) })

	// Scan stdout for progress events and the final filepath.
	finalPath := scanLines(stdout, progressCh, true)

	// Wait for the stderr goroutine to finish draining before cmd.Wait()
	// closes the pipes. When the process exits its stderr fd is closed,
	// causing EOF on our read pipe and unblocking scanner.Scan().
	wg.Wait()

	if err := cmd.Wait(); err != nil {
		return "", fmt.Errorf("yt-dlp exited with error: %w", err)
	}

	return finalPath, nil
}
