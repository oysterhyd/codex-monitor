package main

import (
	"embed"
	"log"

	"local.codex.monitor/internal/nativeapp"
)

// The dashboard, transparent desktop widget and data service run in Go.
//
//go:embed assets/locales/*.json assets/icon.png assets/monitor-glass.png integrations/pi/codex-monitor.ts
var resources embed.FS

func main() {
	if err := nativeapp.Run(resources); err != nil {
		log.Fatal(err)
	}
}
