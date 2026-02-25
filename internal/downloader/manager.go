package downloader

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
)

// JobStatus represents the state of a download job.
type JobStatus string

const (
	StatusQueued      JobStatus = "queued"
	StatusDownloading JobStatus = "downloading"
	StatusProcessing  JobStatus = "processing"
	StatusComplete    JobStatus = "complete"
	StatusError       JobStatus = "error"
	StatusCancelled   JobStatus = "cancelled"
)

// jobTTL is how long finished jobs are retained before being evicted.
const jobTTL = time.Hour

// JobProgress holds current download progress.
type JobProgress struct {
	Percent  float64 `json:"percent"`
	Speed    float64 `json:"speed"`
	ETA      float64 `json:"eta"`
	Elapsed  float64 `json:"elapsed"`
	FileSize int64   `json:"file_size"`
}

// Job represents a download task.
type Job struct {
	ID         string      `json:"id"`
	URL        string      `json:"url"`
	Title      string      `json:"title"`
	FormatID   string      `json:"format_id"`
	Status     JobStatus   `json:"status"`
	Progress   JobProgress `json:"progress"`
	Filename   string      `json:"filename"`
	Error      string      `json:"error,omitempty"`
	CreatedAt  time.Time   `json:"created_at"`
	FinishedAt time.Time   `json:"finished_at,omitempty"`
	QualityTag string      `json:"quality_tag,omitempty"`

	cancel context.CancelFunc
}

// buildQualityTag computes a filename-safe quality/codec string from format metadata.
// For video formats it uses height and vcodec; for audio-only it uses abr and acodec.
func buildQualityTag(height int, abr float64, vcodec, acodec string) string {
	sanitize := func(s string) string {
		return strings.Map(func(r rune) rune {
			if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') ||
				(r >= '0' && r <= '9') || r == '-' {
				return r
			}
			return '_'
		}, s)
	}
	audioOnly := height == 0 && (vcodec == "" || vcodec == "none")
	if audioOnly {
		codec := acodec
		if codec == "" || codec == "none" {
			codec = "audio"
		}
		return fmt.Sprintf("%.0fkbps_%s", abr, sanitize(codec))
	}
	vc := vcodec
	if vc == "" || vc == "none" {
		vc = "video"
	}
	return fmt.Sprintf("%dp_%s", height, sanitize(vc))
}

// JobEvent is sent to SSE subscribers when job state changes.
type JobEvent struct {
	Type string `json:"type"` // job:created, job:progress, job:complete, job:error, job:cancelled
	Job  *Job   `json:"job"`
}

// EventSubscriber receives job events.
type EventSubscriber func(event JobEvent)

// Manager manages download jobs.
type Manager struct {
	mu          sync.RWMutex
	jobs        map[string]*Job
	queue       chan *Job
	ytdlp       *YtDlp
	downloadDir string

	subMu       sync.RWMutex
	subscribers map[string]chan JobEvent
}

// NewManager creates a new job manager.
func NewManager(ytdlp *YtDlp, downloadDir string, maxConcurrent int) *Manager {
	m := &Manager{
		jobs:        make(map[string]*Job),
		queue:       make(chan *Job, 100),
		ytdlp:       ytdlp,
		downloadDir: downloadDir,
		subscribers: make(map[string]chan JobEvent),
	}

	// Start worker pool
	for i := 0; i < maxConcurrent; i++ {
		go m.worker()
	}

	// Start background cleanup of finished jobs
	go m.cleanupLoop()

	return m
}

// Submit creates a new download job and enqueues it.
func (m *Manager) Submit(url, formatID, title string, height int, vcodec, acodec string, abr float64) *Job {
	job := &Job{
		ID:         uuid.New().String(),
		URL:        url,
		Title:      title,
		FormatID:   formatID,
		Status:     StatusQueued,
		CreatedAt:  time.Now(),
		QualityTag: buildQualityTag(height, abr, vcodec, acodec),
	}

	m.mu.Lock()
	m.jobs[job.ID] = job
	m.mu.Unlock()

	m.broadcast(JobEvent{Type: "job:created", Job: job})
	m.queue <- job

	return job
}

// Cancel cancels a running or queued job.
func (m *Manager) Cancel(id string) error {
	m.mu.Lock()
	job, ok := m.jobs[id]
	if !ok {
		m.mu.Unlock()
		return fmt.Errorf("job not found: %s", id)
	}
	if job.Status != StatusQueued && job.Status != StatusDownloading && job.Status != StatusProcessing {
		m.mu.Unlock()
		return fmt.Errorf("job %s is not cancellable (status: %s)", id, job.Status)
	}
	job.Status = StatusCancelled
	job.FinishedAt = time.Now()
	if job.cancel != nil {
		job.cancel()
	}
	m.mu.Unlock()

	m.broadcast(JobEvent{Type: "job:cancelled", Job: job})
	return nil
}

// RemoveByFilename removes the job whose Filename matches and broadcasts a job:removed event.
// It is a no-op if no matching job exists.
func (m *Manager) RemoveByFilename(filename string) {
	m.mu.Lock()
	var removed *Job
	for id, job := range m.jobs {
		if job.Filename == filename {
			removed = job
			delete(m.jobs, id)
			break
		}
	}
	m.mu.Unlock()

	if removed != nil {
		m.broadcast(JobEvent{Type: "job:removed", Job: removed})
	}
}

// List returns all jobs.
func (m *Manager) List() []*Job {
	m.mu.RLock()
	defer m.mu.RUnlock()

	jobs := make([]*Job, 0, len(m.jobs))
	for _, j := range m.jobs {
		jobs = append(jobs, j)
	}
	return jobs
}

// Get returns a single job by ID.
func (m *Manager) Get(id string) (*Job, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	j, ok := m.jobs[id]
	return j, ok
}

// Subscribe creates a new event subscription. Returns the channel and an unsubscribe function.
func (m *Manager) Subscribe(id string) (<-chan JobEvent, func()) {
	ch := make(chan JobEvent, 64)

	m.subMu.Lock()
	m.subscribers[id] = ch
	m.subMu.Unlock()

	unsub := func() {
		m.subMu.Lock()
		delete(m.subscribers, id)
		close(ch)
		m.subMu.Unlock()
	}

	return ch, unsub
}

func (m *Manager) cleanupLoop() {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()
	for range ticker.C {
		cutoff := time.Now().Add(-jobTTL)
		m.mu.Lock()
		for id, job := range m.jobs {
			if !job.FinishedAt.IsZero() && job.FinishedAt.Before(cutoff) {
				delete(m.jobs, id)
			}
		}
		m.mu.Unlock()
	}
}

func (m *Manager) broadcast(event JobEvent) {
	m.subMu.RLock()
	defer m.subMu.RUnlock()

	for _, ch := range m.subscribers {
		select {
		case ch <- event:
		default:
			// Subscriber too slow, drop event
		}
	}
}

func (m *Manager) worker() {
	for job := range m.queue {
		m.mu.RLock()
		if job.Status == StatusCancelled {
			m.mu.RUnlock()
			continue
		}
		m.mu.RUnlock()

		m.processJob(job)
	}
}

func (m *Manager) processJob(job *Job) {
	ctx, cancel := context.WithCancel(context.Background())

	m.mu.Lock()
	job.cancel = cancel
	job.Status = StatusDownloading
	m.mu.Unlock()

	m.broadcast(JobEvent{Type: "job:progress", Job: job})

	progressCh := make(chan Progress, 32)

	// Read progress updates in a goroutine
	done := make(chan struct{})
	go func() {
		defer close(done)
		for p := range progressCh {
			m.mu.Lock()
			if p.Status == "downloading" {
				job.Status = StatusDownloading
				total := p.TotalBytes
				if total == 0 {
					total = p.TotalEstimate
				}
				if p.Percent > 0 {
					job.Progress.Percent = p.Percent
				} else if total > 0 && p.DownloadedBytes > 0 {
					job.Progress.Percent = float64(p.DownloadedBytes) / float64(total) * 100
				}
				job.Progress.Speed = p.Speed
				job.Progress.ETA = p.ETA
				job.Progress.Elapsed = p.Elapsed
				job.Progress.FileSize = total
			} else if p.Status == "finished" || p.Status == "processing" || p.Status == "started" {
				job.Status = StatusProcessing
				job.Progress.Percent = 100
			}
			m.mu.Unlock()

			m.broadcast(JobEvent{Type: "job:progress", Job: job})
		}
	}()

	finalPath, err := m.ytdlp.Download(ctx, job.URL, job.FormatID, m.downloadDir, job.QualityTag, progressCh)
	<-done // Wait for progress reader to finish

	m.mu.Lock()
	if job.Status == StatusCancelled {
		m.mu.Unlock()
		cancel()
		return
	}

	if err != nil {
		job.Status = StatusError
		job.Error = err.Error()
		job.FinishedAt = time.Now()
		m.mu.Unlock()
		m.broadcast(JobEvent{Type: "job:error", Job: job})
		cancel()
		return
	}

	job.Status = StatusComplete
	job.Progress.Percent = 100
	job.FinishedAt = time.Now()
	if finalPath != "" {
		// Rename .tmp.<name> → <name> now that the download is complete.
		dir := filepath.Dir(finalPath)
		base := filepath.Base(finalPath)
		if newBase := strings.TrimPrefix(base, ".tmp."); newBase != base {
			newPath := filepath.Join(dir, newBase)
			if err := os.Rename(finalPath, newPath); err == nil {
				finalPath = newPath
			}
		}
		job.Filename = filepath.Base(finalPath)
	}
	m.mu.Unlock()

	m.broadcast(JobEvent{Type: "job:complete", Job: job})
	cancel()
}
