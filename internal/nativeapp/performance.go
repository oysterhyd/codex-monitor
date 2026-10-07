package nativeapp

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"time"

	"github.com/egoist/mygo"
)

// Only isolated smoke runs collect timings; regular runs do not retain samples.
type switchMeasurement struct {
	cpu, intervals []float64
	last           time.Time
	sceneRenders   int
	stages         map[string]float64
}

func (m *switchMeasurement) stage(name string, started time.Time) {
	if m.stages == nil {
		m.stages = map[string]float64{}
	}
	m.stages[name] = max(m.stages[name], float64(time.Since(started))/float64(time.Millisecond))
}

func (m *switchMeasurement) record(now time.Time, cpu time.Duration) {
	m.cpu = append(m.cpu, float64(cpu)/float64(time.Millisecond))
	if !m.last.IsZero() {
		m.intervals = append(m.intervals, float64(now.Sub(m.last))/float64(time.Millisecond))
	}
	m.last = now
}
func measuredTimes(values []float64) Object {
	if len(values) == 0 {
		return Object{"samples": 0}
	}
	sorted := slices.Clone(values)
	slices.Sort(sorted)
	return Object{"samples": len(sorted), "medianMs": sorted[len(sorted)/2], "p95Ms": sorted[min(len(sorted)-1, int(float64(len(sorted))*.95))], "maxMs": sorted[len(sorted)-1]}
}
func (a *App) verifySwitching() {
	result := Object{"updaterConfigured": mygo.Updater.Enabled()}
	for _, direction := range []string{"toMain", "toWidget"} {
		measurement := &switchMeasurement{}
		for i := 0; i < 4; i++ {
			a.updateWait(func() {
				a.widget.measurement = nil
				if direction == "toMain" {
					a.showWidget()
				} else {
					a.restore()
				}
			})
			time.Sleep(400 * time.Millisecond)
			a.updateWait(func() {
				measurement.last = time.Time{}
				a.widget.measurement = measurement
				a.widget.model.ReduceMotion = a.reduceMotion
				if direction == "toMain" {
					a.restore()
				} else {
					a.toggleWidget()
				}
			})
			time.Sleep(400 * time.Millisecond)
			a.updateWait(func() {
				a.widget.measurement = nil
				settled := a.widgetMode == (direction == "toWidget") && !a.mainFade.active(time.Now())
				if direction == "toWidget" {
					settled = settled && !a.win.IsVisible()
				} else {
					settled = settled && a.win.IsVisible() && a.win.Opacity() == 1
				}
				if !settled {
					a.errorText = "窗口切换验收未完成：" + direction
				}
			})
		}
		result[direction] = Object{"cpu": measuredTimes(measurement.cpu), "interval": measuredTimes(measurement.intervals), "rawIntervalsMs": measurement.intervals, "sceneRenders": measurement.sceneRenders, "stages": measurement.stages}
	}
	// Reverse an in-flight transition, before either fade has completed.
	a.updateWait(func() { a.restore() })
	time.Sleep(45 * time.Millisecond)
	a.updateWait(func() { a.toggleWidget() })
	time.Sleep(45 * time.Millisecond)
	a.updateWait(func() { a.restore() })
	time.Sleep(400 * time.Millisecond)
	a.updateWait(func() {
		result["rapidReverse"] = !a.widgetMode && a.win.IsVisible() && a.win.Opacity() == 1 && !a.widgetClosing
		if !truth(result["rapidReverse"]) {
			a.errorText = "快速反向切换验收失败"
		}
		b, _ := json.MarshalIndent(result, "", "  ")
		_ = os.WriteFile(filepath.Join(a.options.Capture, "switch-performance.json"), b, 0600)
	})
}
