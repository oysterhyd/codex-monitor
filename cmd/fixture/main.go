package main

import (
	"log"
	"os"
	"path/filepath"

	"local.codex.monitor/internal/testfixture"
)

func main() {
	if len(os.Args) != 2 {
		log.Fatal("usage: go run ./cmd/fixture NEW_PROFILE_DIRECTORY")
	}
	dir, err := filepath.Abs(os.Args[1])
	if err != nil {
		log.Fatal(err)
	}
	if err = testfixture.Seed(dir); err != nil {
		log.Fatal(err)
	}
}
