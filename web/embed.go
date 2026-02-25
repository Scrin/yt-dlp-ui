//go:build !dev

package web

import (
	"embed"
	"io/fs"
)

//go:embed dist/*
var distFS embed.FS

// DistFS returns the embedded frontend filesystem with the dist/ prefix stripped.
func DistFS() (fs.FS, error) {
	return fs.Sub(distFS, "dist")
}
