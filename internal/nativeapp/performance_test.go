package nativeapp

import (
	"image"
	"testing"
	"time"

	"github.com/egoist/mygo/ui"
)

// Fixed 150% DPI and virtual time keep before/after runs comparable.
func BenchmarkWidget(b *testing.B) {
	for _, state := range []string{"visibility", "morph", "hover"} {
		b.Run(state, func(b *testing.B) {
			m, p := fixtureWidget(b)
			p.model = &m
			now := time.Date(2026, 10, 7, 12, 0, 0, 0, time.Local)
			p.render(now, 1.5)
			m.ReduceMotion = false
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				switch state {
				case "visibility":
					m.visibility = widgetMotion{from: 0, target: 1, start: now, duration: 240 * time.Millisecond}
				case "morph":
					m.Collapsed = false
					m.shape = widgetMotion{from: 1, target: 0, start: now, duration: 680 * time.Millisecond}
				case "hover":
					m.hoverMotion[0] = widgetMotion{target: 1}
					m.light[0] = [2]float32{.7, .3}
					p.invalidate()
				}
				p.render(now.Add(time.Duration(190+i%12)*time.Millisecond), 1.5)
			}
		})
	}
}

func BenchmarkWidgetBlur(b *testing.B) {
	src := image.NewRGBA(image.Rect(0, 0, 804, 534))
	for i := range src.Pix {
		src.Pix[i] = byte(i)
	}
	b.ReportAllocs()
	var workspace widgetBlurWorkspace
	workspace.full(src, 5)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		workspace.full(src, 5)
	}
}

func BenchmarkWidgetBlurUncached(b *testing.B) {
	src := image.NewRGBA(image.Rect(0, 0, 804, 534))
	for i := range src.Pix {
		src.Pix[i] = byte(i)
	}
	var workspace widgetBlurWorkspace
	workspace.full(src, 5)
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		workspace.filteredSource = nil
		workspace.full(src, 5)
	}
}

func BenchmarkMainVisibility(b *testing.B) {
	a := fixtureApp(b)
	tt := ui.NewTester(a.View, 1380, 960)
	tt.SetScale(1.5)
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		a.widgetClosing = i%2 == 0
		tt.Frame()
	}
}
