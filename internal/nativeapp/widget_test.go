package nativeapp

import (
	"encoding/json"
	"image/png"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/egoist/mygo/ui"
	"local.codex.monitor/internal/testfixture"
)

func fixtureWidget(t testing.TB) (widgetModel, *widgetPainter) {
	t.Helper()
	dir := t.TempDir()
	if err := testfixture.Seed(dir); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join(dir, "widget.json"))
	if err != nil {
		t.Fatal(err)
	}
	m := newWidgetModel()
	if err = json.Unmarshal(raw, &m.Data); err != nil {
		t.Fatal(err)
	}
	normalizeLists(m.Data)
	m.Visible = true
	m.visibility.target = 1
	m.ReduceMotion = true
	if reference := os.Getenv("MONITOR_WIDGET_REFERENCE"); reference != "" {
		raw, err := os.ReadFile(reference)
		if err != nil {
			t.Fatal(err)
		}
		var ref struct {
			Snapshot Object
			Metrics  []struct{ X, Y, Width, Height float64 }
		}
		if err = json.Unmarshal(raw, &ref); err != nil {
			t.Fatal(err)
		}
		m.Data = ref.Snapshot
		m.clock = parseTime(obj(m.Data["scan"])["lastScan"]).Add(time.Second)
		for i, r := range ref.Metrics {
			expected := widgetMetricRect(i)
			if math.Abs(r.X-float64(expected.X)) > 4 || math.Abs(r.Y-float64(expected.Y)) > 4 || math.Abs(r.Width-float64(expected.W)) > 4 || math.Abs(r.Height-float64(expected.H)) > 4 {
				t.Fatalf("legacy geometry mismatch: %d %+v %+v", i, r, expected)
			}
		}
	}
	brand, err := os.ReadFile(filepath.Join("..", "..", "assets", "monitor-glass.png"))
	if err != nil {
		t.Fatal(err)
	}
	bitmap, err := ui.DecodeBitmap(brand)
	if err != nil {
		t.Fatal(err)
	}
	return m, newWidgetPainter(nil, bitmap)
}
func TestWidgetNativeSnapshots(t *testing.T) {
	m, p := fixtureWidget(t)
	p.model = &m
	now := time.Now()
	if !m.clock.IsZero() {
		now = m.clock
	}
	for _, state := range []string{"card", "orb", "english-expired", "disconnected"} {
		switch state {
		case "orb":
			m.toggle(now)
		case "english-expired":
			m.toggle(now)
			m.Data["language"] = "en"
		case "disconnected":
			m.Error = "test disconnected"
		}
		p.invalidate()
		img := p.render(now, 1.5)
		if img.Bounds().Dx() != 840 || img.Bounds().Dy() != 570 {
			t.Fatal("DPI size drift")
		}
		if img.RGBAAt(0, 0).A != 0 {
			t.Fatal("transparent padding became opaque")
		}
		if out := os.Getenv("MONITOR_WIDGET_CAPTURE"); out != "" {
			if err := os.MkdirAll(out, 0700); err != nil {
				t.Fatal(err)
			}
			f, err := os.Create(filepath.Join(out, state+".png"))
			if err != nil {
				t.Fatal(err)
			}
			err = png.Encode(f, img)
			f.Close()
			if err != nil {
				t.Fatal(err)
			}
		}
	}
}

func TestWidgetQuotaFreshnessAndUnknownValues(t *testing.T) {
	now := time.Date(2026, 10, 7, 11, 0, 0, 0, time.UTC)
	m := newWidgetModel()
	m.Data = Object{"language": "en", "scan": map[string]any{"lastScan": now.Format(time.RFC3339), "sourceExists": true, "errors": 0.}, "quotaStatus": map[string]any{"ok": true}, "quotas": []any{map[string]any{"minutes": 300., "used": 46., "ts": now.Format(time.RFC3339), "resets": float64(now.Add(time.Minute).Unix())}}, "cacheRate": 0., "tps": 0.}
	metrics := m.metrics(now)
	if widgetPercent(metrics[0].Value) != "54%" || metrics[2].Value == nil || metrics[3].Value == nil {
		t.Fatal("valid zero data was marked unknown")
	}
	if m.metrics(now.Add(16 * time.Second))[2].Value != nil {
		t.Fatal("stale scan still displayed live TPS")
	}
	m.Data["quotaStatus"] = map[string]any{"ok": false}
	value, tip := m.quota(300, now)
	if value == nil || !strings.HasPrefix(tip, "Saved · retrying · ") {
		t.Fatal("saved quota did not retain value and freshness hint")
	}
	value, tip = m.quota(300, now.Add(2*time.Minute))
	if value != nil || !strings.HasPrefix(tip, "Awaiting reset · ") {
		t.Fatal("expired quota remained usable")
	}
	m.Data["cacheRate"] = nil
	m.Error = "disconnected"
	if m.collecting(now) || m.metrics(now)[3].Value != nil {
		t.Fatal("missing cache or interrupted collection lost unknown state")
	}
}
func TestWidgetMorphAndInertControls(t *testing.T) {
	now := time.Now()
	m := newWidgetModel()
	m.toggle(now)
	r := m.glass(now.Add(150 * time.Millisecond))
	if r.W <= 120 || r.W >= 536 || !m.toggleBusy(now.Add(700*time.Millisecond)) {
		t.Fatal("morph geometry/timing changed")
	}
	if m.hit(35, 45, now) == 0 || m.hit(505, 50, now) != 7 {
		t.Fatal("collapsed card controls were not inert")
	}
	r = m.glass(now.Add(time.Second))
	if r.W != 120 || r.H != 120 || r.X != 428 {
		t.Fatal("orb anchor moved")
	}
	m.ReduceMotion = true
	m.toggle(now.Add(time.Second))
	r = m.glass(now.Add(time.Second))
	if r.W != 536 || r.H != 356 || m.morphing(now.Add(time.Second)) {
		t.Fatal("reduced motion did not settle immediately")
	}
}
func TestWidgetCompactNumbers(t *testing.T) {
	for _, test := range []struct {
		value any
		want  string
	}{{nil, "—"}, {0., "0"}, {12.45, "12.45"}, {44480., "44.48K"}, {999999., "1M"}, {1e12, "1T"}} {
		if got := widgetCompact(test.value); got != test.want {
			t.Fatalf("%v: %s instead of %s", test.value, got, test.want)
		}
	}
}
