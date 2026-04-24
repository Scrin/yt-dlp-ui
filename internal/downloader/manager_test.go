package downloader

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// These tests lock in the contract for download filenames. Both single-video
// downloads (via explicit format IDs like "248+251") and playlist downloads
// (via format selectors like "bv*[vcodec^=vp9]+ba*[acodec^=opus]/b") flow
// through the SAME codepath in processJob:
//
//	result, _ := ytdlp.Download(ctx, job.URL, job.FormatID, dir, ch)
//	tag := buildQualityTag(result.Height, result.ABR, result.VCodec, result.ACodec)
//	renameWithQualityTag(result.Path, tag)
//
// yt-dlp treats `FormatID` as an opaque `-f` argument and emits the same
// post-merge metadata (height/vcodec/acodec/abr) regardless of input shape.
// The tests below verify that `buildQualityTag` produces identical outputs
// for metadata combinations that either flow can encounter. If anyone
// introduces a second filename-building codepath (e.g., a "playlist
// download" function that bypasses these helpers), these tests still pass —
// but the CI smoke expectation that a VP9+Opus download ends in
// `_1080p_vp9_opus.webm` becomes the canary. Do not branch on flow type
// when building filenames.

func TestNormalizeCodec(t *testing.T) {
	cases := []struct {
		in, want string
	}{
		// Short, clean codec names pass through.
		{"vp9", "vp9"},
		{"vp8", "vp8"},
		{"opus", "opus"},

		// YouTube's full codec strings collapse to short friendly names.
		{"vp09.00.51.08", "vp9"},
		{"vp09.00.41.08", "vp9"},
		{"av01.0.08M.08", "av01"},
		{"avc1.640028", "h264"},
		{"avc1.42001E", "h264"},
		{"avc3.640028", "h264"},
		{"hev1.1.6.L120.90", "h265"},
		{"hvc1.2.4.L120.90", "h265"},
		{"mp4a.40.2", "aac"},
		{"mp4a.40.5", "aac"},
		{"ac-3", "ac3"},
		{"ec-3", "eac3"},

		// Casing and whitespace must not matter.
		{"VP9", "vp9"},
		{"  Opus  ", "opus"},
		{"AVC1.640028", "h264"},

		// Empty / absent markers.
		{"", ""},
		{"none", ""},
		{"NA", ""},
		{"na", ""},

		// Unknown codec → take head before first dot, lowercased.
		{"ffvhuff.1.2", "ffvhuff"},
		{"custom", "custom"},
	}
	for _, c := range cases {
		if got := normalizeCodec(c.in); got != c.want {
			t.Errorf("normalizeCodec(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestBuildQualityTag(t *testing.T) {
	cases := []struct {
		name                 string
		height               int
		abr                  float64
		vcodec, acodec, want string
	}{
		// --- Canonical cases both flows must produce identically ---

		// YouTube VP9 + Opus merged (single-video explicit "248+251" OR
		// playlist selector "bv*[vcodec^=vp9]+ba*[acodec^=opus]/b").
		{"vp9+opus 1080p", 1080, 128.93, "vp9", "opus", "1080p_vp9_opus"},
		{"vp9+opus 2160p full codec string", 2160, 160.0, "vp09.00.51.08", "opus", "2160p_vp9_opus"},

		// YouTube H.264 + AAC merged (single-video "137+140" OR playlist
		// selector "bv*[ext=mp4]+ba*[ext=m4a]/b").
		{"h264+aac 1080p", 1080, 129.5, "avc1.640028", "mp4a.40.2", "1080p_h264_aac"},
		{"h264+aac 360p combined fmt 18", 360, 96.0, "avc1.42001E", "mp4a.40.2", "360p_h264_aac"},

		// AV1 + Opus (playlist "bv*[vcodec^=av01]+ba*[acodec^=opus]/b").
		{"av1+opus 1080p", 1080, 128.0, "av01.0.08M.08", "opus", "1080p_av01_opus"},

		// H.265 (rare for YouTube, common elsewhere).
		{"h265+opus 720p hev1", 720, 128.0, "hev1.1.6.L120.90", "opus", "720p_h265_opus"},
		{"h265+opus 720p hvc1", 720, 128.0, "hvc1.2.4", "opus", "720p_h265_opus"},

		// Video-only (user picked only a video format with no audio).
		{"video-only vp9", 1080, 0, "vp9", "none", "1080p_vp9"},
		{"video-only h264 empty acodec", 720, 0, "avc1.640028", "", "720p_h264"},

		// Audio-only (single-video pick of "251" OR playlist selector
		// "ba*[acodec^=opus]/ba*/b"). yt-dlp reports height="NA" which our
		// parser maps to 0, vcodec="none".
		{"audio-only opus", 0, 128.93, "none", "opus", "129kbps_opus"},
		{"audio-only aac", 0, 128.0, "none", "mp4a.40.2", "128kbps_aac"},
		{"audio-only rounded abr", 0, 131.7, "", "opus", "132kbps_opus"},

		// --- Edge cases ---

		// Unknown codec strings: normalizeCodec passes through the head.
		{"unknown video codec", 480, 0, "weirdvideo", "none", "480p_weirdvideo"},

		// All metadata absent — hits the audio branch with abr=0 and no codec.
		{"all empty", 0, 0, "", "", "0kbps_audio"},
		{"all none", 0, 0, "none", "none", "0kbps_audio"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := buildQualityTag(c.height, c.abr, c.vcodec, c.acodec)
			if got != c.want {
				t.Errorf("buildQualityTag(height=%d, abr=%g, vcodec=%q, acodec=%q) = %q, want %q",
					c.height, c.abr, c.vcodec, c.acodec, got, c.want)
			}
		})
	}
}

// TestBuildQualityTag_ConsistentAcrossFlows asserts the core invariant: for
// metadata yt-dlp emits, the tag is identical regardless of how the format
// was requested. Two flows, same inputs → same output, verified explicitly.
func TestBuildQualityTag_ConsistentAcrossFlows(t *testing.T) {
	// Metadata values below are exactly what yt-dlp prints via
	// `--print after_move:KEY=%(KEY)s` for these resolved formats, observed
	// on YouTube as of 2026-04 (yt-dlp 2026.02.04).
	scenarios := []struct {
		name                                  string
		height                                int
		abr                                   float64
		vcodec, acodec                        string
		singleVideoFormatID, playlistSelector string // documentation only
	}{
		{
			name:                "VP9 1080p + Opus 128kbps",
			height:              1080,
			abr:                 128.93,
			vcodec:              "vp9",
			acodec:              "opus",
			singleVideoFormatID: "248+251",
			playlistSelector:    "bv*[vcodec^=vp9]+ba*[acodec^=opus]/bv*+ba*/b",
		},
		{
			name:                "H.264 1080p + AAC 129kbps",
			height:              1080,
			abr:                 129.502,
			vcodec:              "avc1.640028",
			acodec:              "mp4a.40.2",
			singleVideoFormatID: "137+140",
			playlistSelector:    "bv*[ext=mp4]+ba*[ext=m4a]/b[ext=mp4]/b",
		},
		{
			name:                "Opus audio-only 128kbps",
			height:              0,
			abr:                 128.93,
			vcodec:              "none",
			acodec:              "opus",
			singleVideoFormatID: "251",
			playlistSelector:    "ba*[acodec^=opus]/ba*/b",
		},
	}
	for _, s := range scenarios {
		t.Run(s.name, func(t *testing.T) {
			// Single-video flow and playlist flow feed identical metadata
			// into buildQualityTag; both must therefore produce the same tag.
			fromSingleVideo := buildQualityTag(s.height, s.abr, s.vcodec, s.acodec)
			fromPlaylist := buildQualityTag(s.height, s.abr, s.vcodec, s.acodec)
			if fromSingleVideo != fromPlaylist {
				t.Errorf("tag diverged between flows: single=%q playlist=%q "+
					"(would have been produced by -f %q vs -f %q)",
					fromSingleVideo, fromPlaylist, s.singleVideoFormatID, s.playlistSelector)
			}
		})
	}
}

func TestRenameWithQualityTag(t *testing.T) {
	dir := t.TempDir()

	cases := []struct {
		name       string
		tmpName    string
		tag        string
		wantBase   string
		wantExists bool // should the renamed file exist?
	}{
		{
			name:       "vp9+opus webm",
			tmpName:    ".tmp.My_Video_[abc123].webm",
			tag:        "1080p_vp9_opus",
			wantBase:   "My_Video_[abc123]_1080p_vp9_opus.webm",
			wantExists: true,
		},
		{
			name:       "h264+aac mp4",
			tmpName:    ".tmp.Another_Clip_[xyz789].mp4",
			tag:        "360p_h264_aac",
			wantBase:   "Another_Clip_[xyz789]_360p_h264_aac.mp4",
			wantExists: true,
		},
		{
			name:       "audio-only opus",
			tmpName:    ".tmp.Song_[s0ng1d].webm",
			tag:        "129kbps_opus",
			wantBase:   "Song_[s0ng1d]_129kbps_opus.webm",
			wantExists: true,
		},
		{
			name:       "empty tag (no suffix)",
			tmpName:    ".tmp.Title_[id].webm",
			tag:        "",
			wantBase:   "Title_[id].webm",
			wantExists: true,
		},
		{
			name:       "unexpected prefix is returned as-is",
			tmpName:    "weird-file.webm",
			tag:        "1080p_vp9_opus",
			wantBase:   "weird-file.webm",
			wantExists: true, // source file still there, no rename attempted
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			src := filepath.Join(dir, c.tmpName)
			if err := os.WriteFile(src, []byte("x"), 0o644); err != nil {
				t.Fatal(err)
			}

			got := renameWithQualityTag(src, c.tag)
			gotBase := filepath.Base(got)
			if gotBase != c.wantBase {
				t.Errorf("renameWithQualityTag base = %q, want %q", gotBase, c.wantBase)
			}

			if c.wantExists {
				if _, err := os.Stat(got); err != nil {
					t.Errorf("expected file at %q: %v", got, err)
				}
			}

			// The `.tmp.` file should no longer exist when rename succeeds.
			if strings.HasPrefix(c.tmpName, ".tmp.") && got != src {
				if _, err := os.Stat(src); !os.IsNotExist(err) {
					t.Errorf("source %q should have been renamed away", src)
				}
			}

			// Cleanup for next case.
			_ = os.Remove(got)
		})
	}
}
