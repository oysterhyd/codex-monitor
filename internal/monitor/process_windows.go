//go:build windows

package monitor

import (
	"golang.org/x/sys/windows"
	"os/exec"
	"syscall"
)

func hideProcess(cmd *exec.Cmd) { cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true} }
func processAlive(pid int) bool {
	h, e := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, uint32(pid))
	if e == windows.ERROR_INVALID_PARAMETER {
		return false
	}
	if e != nil {
		return true
	}
	defer windows.CloseHandle(h)
	var code uint32
	if windows.GetExitCodeProcess(h, &code) != nil {
		return true
	}
	return code == 259
}
