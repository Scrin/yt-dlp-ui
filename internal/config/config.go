package config

import "os"

type Config struct {
	Port          string
	DownloadDir   string
	MaxConcurrent int
	YtDlpPath     string
}

func Load() *Config {
	return &Config{
		Port:          getEnv("PORT", "8080"),
		DownloadDir:   getEnv("DOWNLOAD_DIR", "./downloads"),
		MaxConcurrent: getEnvInt("MAX_CONCURRENT", 2),
		YtDlpPath:     getEnv("YT_DLP_PATH", "yt-dlp"),
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
