package main

import (
	"embed"
	"log"

	"local.codex.monitor/internal/nativeapp"
)

// The dashboard and data service run in Go; the transparent widget is bundled separately.
//
//go:embed assets/locales/*.json assets/icon.png assets/monitor-glass.png
var resources embed.FS

func main() {
	if err := nativeapp.Run(resources); err != nil {
		log.Fatal(err)
	}
}
