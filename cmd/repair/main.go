// repair reconstructs a corrupt monitor database without replacing the source.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"local.codex.monitor/internal/monitor"
	"os"
	"path/filepath"
)

func run() error {
	source := flag.String("source", "", "existing monitor.sqlite path")
	output := flag.String("output", "", "new recovered database path (must not exist)")
	flag.Parse()
	if *source == "" || *output == "" {
		return fmt.Errorf("请指定 --source 和 --output；先从托盘完全退出 Codex Monitor")
	}
	release, err := monitor.AcquireProfileLock(filepath.Dir(*source))
	if err != nil {
		return err
	}
	defer release()
	counts, err := monitor.RecoverDatabase(*source, *output)
	if err != nil {
		return err
	}
	b, err := json.Marshal(counts)
	if err != nil {
		return err
	}
	fmt.Printf("完整性检查通过；原数据库保持不变。\n恢复文件：%s\n各表行数：%s\n", *output, b)
	return nil
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
