//go:build !windows

package monitor

import (
	"os"
	"os/exec"
	"syscall"
)

func hideProcess(cmd *exec.Cmd) {}
func processAlive(pid int) bool {
	p, e := os.FindProcess(pid)
	return e == nil && (p.Signal(syscall.Signal(0)) == nil)
}
