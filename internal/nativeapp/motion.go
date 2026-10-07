package nativeapp

import (
	"github.com/egoist/mygo/ui"
	"math"
	"time"
)

// Keep the original src/theme.css timings and cubic-bezier(.22,1,.36,1).
const (
	motionQuick  = 180 * time.Millisecond
	motionEnter  = 320 * time.Millisecond
	motionLens   = 420 * time.Millisecond
	motionNumber = 450 * time.Millisecond
	motionFill   = 640 * time.Millisecond
	motionReveal = 780 * time.Millisecond
)

func motionEase(t float32) float32 {
	if t <= 0 {
		return 0
	}
	if t >= 1 {
		return 1
	}
	lo, hi := float32(0), float32(1)
	for i := 0; i < 14; i++ {
		m := (lo + hi) / 2
		u := 1 - m
		x := 3*u*u*m*.22 + 3*u*m*m*.36 + m*m*m
		if x < t {
			lo = m
		} else {
			hi = m
		}
	}
	m := (lo + hi) / 2
	return 1 - (1-m)*(1-m)*(1-m)
}
func enterMotion(x, y float32) ui.ElementTransition {
	return ui.ElementTransition{Duration: motionEnter, Ease: motionEase, Position: true, Enter: &ui.Motion{X: x, Y: y}}
}

type numericMotion struct {
	known               bool
	from, target, shown float64
	start, last, pulse  time.Time
}

func (m *numericMotion) value(now time.Time, value any, reduce bool) (any, float32, bool) {
	if value == nil {
		m.known = false
		m.last = now
		return nil, 0, false
	}
	n := number(value)
	if !m.known || reduce || (!m.last.IsZero() && now.Sub(m.last) > time.Second) {
		*m = numericMotion{known: true, from: n, target: n, shown: n, last: now}
		return value, 0, false
	}
	if n != m.target {
		m.from, m.target, m.start, m.pulse = m.shown, n, now, now
	}
	m.last = now
	t := min(1., max(0., float64(now.Sub(m.start))/float64(motionNumber)))
	m.shown = m.from + (m.target-m.from)*(1-math.Pow(1-t, 3))
	if t >= 1 {
		m.shown = m.target
	}
	pulse := float32(0)
	if !m.pulse.IsZero() {
		p := float32(now.Sub(m.pulse)) / float32(motionFill)
		if p < 1 {
			pulse = .45 * (1 - motionEase(max(0, p)))
		}
	}
	return m.shown, pulse, t < 1 || pulse > 0
}
func animatedValue(c *ui.Context, key string, value any, format func(any) string, emphasize bool) *ui.Element {
	box := ui.Row(c).Key(key)
	m := ui.Local(box, "number", func() numericMotion { return numericMotion{} })
	shown, pulse, active := m.value(c.Now(), value, c.Preferences().ReduceMotion)
	if active {
		c.AnimationFrame()
	}
	if emphasize && pulse > 0 {
		box.TextColor(c.Theme().Text.Mix(c.Theme().Accent, pulse))
	}
	box.Children(func() { ui.Text(c, format(shown)) })
	return box
}
func animatedProgress(c *ui.Context, key string, value float64) *ui.Element {
	e := ui.Progress(c, value).Key(key)
	first := ui.Local(e, "fill-initialized", func() bool { return false })
	if !*first {
		e.AnimateWith("fill", 0, motionFill, motionEase)
		*first = true
	}
	shown := e.AnimateWith("fill", float32(value), motionFill, motionEase)
	if c.Preferences().ReduceMotion {
		shown = float32(value)
	}
	e.Draw(func(p *ui.Painter, r ui.Rect) {
		p.Fill(ui.Rect{X: r.X, Y: r.Y, W: r.W * shown, H: r.H}, c.Theme().Accent, c.Theme().Space(.75))
	})
	return e
}
