package nativeapp

import (
	"testing"

	"github.com/egoist/mygo/ui"
)

func TestTelemetrySettingsShowAutomaticSetupAndConnectionState(t *testing.T) {
	a := fixtureApp(t)
	a.data["telemetry"] = Object{"listening": true, "codex": Object{"state": "ready", "restartRequired": true}, "pi": Object{"state": "ready"}}
	view := func(c *ui.Context) { a.telemetrySettings(c, obj(a.data["settings"])) }
	tt := ui.NewTester(view, 1200, 760)
	if !tt.HasText("接收就绪，等待新调用") || !tt.HasText("重新检查自动配置") {
		t.Fatal(tt.Texts())
	}
	for _, manual := range []string{"复制 Codex 采集配置", "导出 Pi 扩展"} {
		if tt.HasText(manual) {
			t.Fatal("manual setup is still required")
		}
	}
	obj(a.data["telemetry"])["ttftSamples"] = 1
	connected := ui.NewTester(view, 1200, 760)
	if !connected.HasText("已收到首字数据") {
		t.Fatal(connected.Texts())
	}
	captureCallView(t, connected, "telemetry-auto-setup")
}
