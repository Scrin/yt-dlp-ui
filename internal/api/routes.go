package api

import (
	"io/fs"
	"net/http"
	"strings"

	"github.com/Scrin/yt-dlp-ui/internal/downloader"
	"github.com/gin-gonic/gin"
)

// SetupRoutes configures all API routes on the Gin engine.
func SetupRoutes(r *gin.Engine, mgr *downloader.Manager, ytdlp *downloader.YtDlp, downloadDir string, webFS fs.FS) {
	// API routes
	api := r.Group("/api")
	{
		api.POST("/resolve", handleResolveURL(ytdlp))
		api.POST("/downloads", handleStartDownload(mgr))
		api.GET("/downloads", handleListDownloads(mgr))
		api.DELETE("/downloads/:id", handleCancelDownload(mgr))
		api.GET("/events", handleSSE(mgr))
		api.GET("/files", handleListFiles(downloadDir))
		api.DELETE("/files/:name", handleDeleteFile(downloadDir, mgr))
	}

	// Serve downloaded files
	r.GET("/files/*filepath", handleServeFile(downloadDir))

	// SPA fallback: serve embedded frontend
	if webFS != nil {
		r.NoRoute(spaHandler(webFS))
	}
}

// spaHandler serves the embedded frontend with SPA fallback routing.
// If the requested path exists as a static file, serve it directly.
// Otherwise, serve index.html for client-side routing.
func spaHandler(webFS fs.FS) gin.HandlerFunc {
	fileServer := http.FileServer(http.FS(webFS))

	return func(c *gin.Context) {
		path := strings.TrimPrefix(c.Request.URL.Path, "/")

		// Try to open the file
		f, err := webFS.Open(path)
		if err == nil {
			f.Close()
			fileServer.ServeHTTP(c.Writer, c.Request)
			return
		}

		// File not found — serve index.html for SPA routing
		c.Request.URL.Path = "/"
		fileServer.ServeHTTP(c.Writer, c.Request)
	}
}
