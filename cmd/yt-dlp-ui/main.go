package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/Scrin/yt-dlp-ui/internal/api"
	"github.com/Scrin/yt-dlp-ui/internal/config"
	"github.com/Scrin/yt-dlp-ui/internal/downloader"
	"github.com/Scrin/yt-dlp-ui/web"
	"github.com/gin-gonic/gin"
)

func main() {
	cfg := config.Load()

	// Ensure download directory exists
	if err := os.MkdirAll(cfg.DownloadDir, 0755); err != nil {
		log.Fatalf("Failed to create download directory %s: %v", cfg.DownloadDir, err)
	}

	ytdlp := downloader.NewYtDlp(cfg.YtDlpPath)
	mgr := downloader.NewManager(ytdlp, cfg.DownloadDir, cfg.MaxConcurrent)

	webFS, err := web.DistFS()
	if err != nil {
		log.Fatalf("Failed to load embedded frontend: %v", err)
	}
	if webFS == nil {
		log.Println("Running in dev mode — frontend not embedded, use Vite dev server")
	}

	r := gin.Default()
	api.SetupRoutes(r, mgr, ytdlp, cfg.DownloadDir, webFS)

	srv := &http.Server{
		Addr:    ":" + cfg.Port,
		Handler: r,
	}

	// Graceful shutdown
	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		<-sigCh

		log.Println("Shutting down...")
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := srv.Shutdown(ctx); err != nil {
			log.Printf("Server shutdown error: %v", err)
		}
	}()

	log.Printf("Starting server on :%s", cfg.Port)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("Server error: %v", err)
	}
}
