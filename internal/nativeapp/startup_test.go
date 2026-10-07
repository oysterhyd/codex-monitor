package nativeapp

import (
	"errors"
	"fmt"
	"local.codex.monitor/internal/monitor"
	"reflect"
	"strings"
	"testing"
)

func TestStartupErrorOffersRepairOnlyForIntegrityFailures(t *testing.T) {
	corrupt := fmt.Errorf("%w：invalid index page", monitor.ErrDatabaseIntegrity)
	options := startupErrorDialog(corrupt)
	if !reflect.DeepEqual(options.Buttons, []string{"关闭", "备份并修复"}) || !strings.Contains(options.Detail, "invalid index page") || !strings.Contains(options.Detail, "database-backups") {
		t.Fatalf("repair action or details missing: %+v", options)
	}
	options = startupErrorDialog(errors.New("另一个 Codex Monitor 正在使用此数据目录"))
	if !reflect.DeepEqual(options.Buttons, []string{"关闭"}) {
		t.Fatal("repair offered for an active profile")
	}
}
