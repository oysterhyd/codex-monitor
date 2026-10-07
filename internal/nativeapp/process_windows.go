package nativeapp

import (
	"os/exec"
	"syscall"
)

func hideProcess(cmd *exec.Cmd) { cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true} }
