package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/Scrin/yt-dlp-ui/internal/downloader"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// handleSSE streams job events to the client via Server-Sent Events.
func handleSSE(mgr *downloader.Manager) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Content-Type", "text/event-stream")
		c.Header("Cache-Control", "no-cache")
		c.Header("Connection", "keep-alive")
		c.Header("X-Accel-Buffering", "no") // Disable nginx buffering

		subID := uuid.New().String()
		events, unsub := mgr.Subscribe(subID)
		defer unsub()

		// Send current job state as initial payload
		for _, job := range mgr.List() {
			data, _ := json.Marshal(downloader.JobEvent{
				Type: "job:init",
				Job:  job,
			})
			fmt.Fprintf(c.Writer, "data: %s\n\n", data)
		}
		// Always flush immediately so onopen fires even when there are no jobs
		fmt.Fprintf(c.Writer, ": ping\n\n")
		c.Writer.(http.Flusher).Flush()

		ctx := c.Request.Context()
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				fmt.Fprintf(c.Writer, ": ping\n\n")
				c.Writer.(http.Flusher).Flush()
			case event, ok := <-events:
				if !ok {
					return
				}
				data, err := json.Marshal(event)
				if err != nil {
					continue
				}
				fmt.Fprintf(c.Writer, "data: %s\n\n", data)
				c.Writer.(http.Flusher).Flush()
			}
		}
	}
}

// handleSSEPost provides a streaming alternative for environments where
// EventSource is not available. It accepts POST and streams responses.
// Not used in MVP but reserved for future use.
var _ = io.Discard
