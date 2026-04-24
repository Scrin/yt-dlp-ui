package config

import "os"

type Config struct {
	Port          string
	DownloadDir   string
	MaxConcurrent int
	YtDlpPath     string
	// FfmpegPath is passed to yt-dlp as --ffmpeg-location when non-empty.
	// Accepts either a directory containing ffmpeg+ffprobe or a full binary
	// path. Empty means "let yt-dlp find it on $PATH" (the usual case).
	FfmpegPath string
}

func Load() *Config {
	return &Config{
		Port:          getEnv("PORT", "8080"),
		DownloadDir:   getEnv("DOWNLOAD_DIR", "./downloads"),
		MaxConcurrent: getEnvInt("MAX_CONCURRENT", 2),
		YtDlpPath:     getEnv("YT_DLP_PATH", "yt-dlp"),
		FfmpegPath:    os.Getenv("FFMPEG_PATH"),
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getEnvInt(key string, fallback int) int {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	n := 0
	for _, c := range v {
		if c < '0' || c > '9' {
			return fallback
		}
		n = n*10 + int(c-'0')
	}
	if n == 0 {
		return fallback
	}
	return n
}
