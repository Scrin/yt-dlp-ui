//go:build dev

package web

import "io/fs"

// DistFS returns nil in dev mode — the frontend is served by Vite's dev server.
func DistFS() (fs.FS, error) {
	return nil, nil
}
