//go:build !windows

package nativeapp

import "os/exec"

func hideProcess(cmd *exec.Cmd) {}
