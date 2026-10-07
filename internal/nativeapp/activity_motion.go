package nativeapp

import (
	"fmt"
	"time"

	"github.com/egoist/mygo/ui"
)

// Paint-only motion keeps chart geometry and hit targets stable. Once settled,
// no more frames are requested until data or pointer input changes.
func paintMotion(c *ui.Context, p *ui.Painter, m *widgetMotion, target float32, duration time.Duration) float32 {
	if c.Preferences().ReduceMotion {
		*m = widgetMotion{target: target}
	} else if m.target != target {
		m.to(target, p.Now(), duration)
	}
	if m.active(p.Now()) {
		p.AnimationFrame()
	}
	return m.value(p.Now())
}

func calendarCell(c *ui.Context, p *ui.Painter, grid, cell *ui.Element, r ui.Rect, color, border ui.Color, started time.Time, week int, light *widgetMotion, enabled, today, selected bool) {
	reveal := float32(1)
	if !c.Preferences().ReduceMotion {
		reveal = motionEase(float32(p.Now().Sub(started)-time.Duration(week)*5*time.Millisecond) / float32(motionLens))
		if reveal < 1 {
			p.AnimationFrame()
		}
	}
	x, y, over := grid.PointerPosition()
	target := float32(0)
	if over {
		target = 1
	}
	glow := paintMotion(c, p, light, target, motionQuick)
	b := grid.Bounds()
	dx, dy := r.X+r.W/2-b.X-x, r.Y+r.H/2-b.Y-y
	proximity := max(0, 1-(dx*dx+dy*dy)/(42*42)) * glow
	if !enabled {
		proximity = 0
	}
	hover := enabled && cell.Hovered()
	if hover && !c.Preferences().ReduceMotion {
		// Expand only the painted tile inside the existing four-DIP gutter.
		r = ui.Rect{X: r.X - 1, Y: r.Y - 1, W: r.W + 2, H: r.H + 2}
	}
	p.Fill(r, c.Theme().SurfaceHover.Mix(color, .25+.75*reveal).Mix(c.Theme().Accent, proximity*.22), 3)
	p.Stroke(r, border.Mix(c.Theme().Accent, proximity*.75), 3, 1)
	if hover || cell.FocusVisible() {
		p.Stroke(r, c.Theme().Accent, 3, 1.5)
	}
	if today || selected {
		outline, width := c.Theme().Accent, float32(1)
		if selected {
			outline, width = c.Theme().Text, 2
		}
		p.Stroke(ui.Rect{X: r.X - 2, Y: r.Y - 2, W: r.W + 4, H: r.H + 4}, outline, 3, width)
	}
}

func activityRowHover(c *ui.Context, row *ui.Element) {
	row.Hovered()
	row.PointerPosition()
	m := ui.Local(row, "hover", func() widgetMotion { return widgetMotion{} })
	row.Draw(func(p *ui.Painter, r ui.Rect) {
		target := float32(0)
		if row.Hovered() || row.FocusVisible() {
			target = 1
		}
		amount := paintMotion(c, p, m, target, motionQuick)
		if amount > 0 {
			p.Fill(r, c.Theme().Accent.Alpha(.06*amount), 7)
			x, _, _ := row.PointerPosition()
			p.Clip(r, 7, func() {
				p.FillGradient(ui.Rect{X: r.X + x - 55, Y: r.Y, W: 110, H: r.H}, ui.LinearGradient{From: c.Theme().Accent.Alpha(.08 * amount), To: ui.Transparent, Angle: 0}, 7)
			})
		}
	})
}

type activityHourMotion struct {
	started time.Time
	known   bool
	bars    [24]widgetMotion
	hover   [24]widgetMotion
}

// The same geometry drives painting and pointer selection, including gutters.
func activityHourAt(x, width float32) int {
	if width <= 0 || x < 0 || x >= width {
		return -1
	}
	return min(23, int(x/width*24))
}

func (a *App) activityHours(c *ui.Context, activity Object) {
	var hours [24]Object
	maximum := 1.0
	for _, h := range objects(activity["hours"]) {
		i := int(number(h["hour"]))
		if i >= 0 && i < len(hours) {
			hours[i] = h
			maximum = max(maximum, number(h["total"]))
		}
	}
	plot := ui.Box(c).Key(fmt.Sprintf("hours-%v", activity["year"])).Height(166).Shrink(0).Margin(14, 0, 0, 0).Focusable().Label(a.tr("活跃时段柱状图"))
	m := ui.Local(plot, "motion", func() activityHourMotion { return activityHourMotion{started: c.Now()} })
	keyboard := ui.Local(plot, "hour", func() int { return 0 })
	x, _, over := plot.PointerPosition()
	plot.Hovered()
	selected := -1
	if over {
		selected = activityHourAt(x, plot.Bounds().W)
	}
	if plot.Clicked() && selected >= 0 {
		*keyboard = selected
	}
	if plot.Focused() {
		if plot.Shortcut(0, ui.KeyLeft) {
			*keyboard = max(0, *keyboard-1)
		}
		if plot.Shortcut(0, ui.KeyRight) {
			*keyboard = min(23, *keyboard+1)
		}
		if plot.Shortcut(0, ui.KeyHome) {
			*keyboard = 0
		}
		if plot.Shortcut(0, ui.KeyEnd) {
			*keyboard = 23
		}
		if !over || plot.FocusVisible() {
			selected = *keyboard
		}
	}
	plot.Draw(func(p *ui.Painter, r ui.Rect) {
		step := r.W / 24
		gap := min(float32(6), step*.3)
		barHeight := r.H - 26
		for i, h := range hours {
			target := float32(number(h["total"]) / maximum)
			bar := &m.bars[i]
			if !m.known && !c.Preferences().ReduceMotion {
				*bar = widgetMotion{target: target, start: m.started.Add(time.Duration(i) * 8 * time.Millisecond), duration: motionFill}
			}
			value := paintMotion(c, p, bar, target, motionFill)
			focus := float32(0)
			if i == selected {
				focus = 1
			}
			emphasis := paintMotion(c, p, &m.hover[i], focus, motionQuick)
			track := ui.Rect{X: r.X + step*float32(i) + gap/2, Y: r.Y, W: step - gap, H: barHeight}
			p.Fill(track, c.Theme().SurfaceHover.Alpha(.38).Mix(c.Theme().Accent.Alpha(.12), emphasis), 4)
			height := max(float32(2), barHeight*value)
			fill := ui.Rect{X: track.X, Y: track.Y + barHeight - height, W: track.W, H: height}
			p.FillGradient(fill, ui.LinearGradient{From: c.Theme().Surface.Mix(c.Theme().Accent, .65), To: c.Theme().Accent, Angle: 0}, 4)
			if emphasis > 0 {
				p.Stroke(track, c.Theme().Accent.Alpha(.7*emphasis), 4, 1)
				p.Fill(ui.Rect{X: fill.X + fill.W/2 - 2, Y: fill.Y - 2, W: 4, H: 4}, c.Theme().Accent.Alpha(emphasis), 2)
			}
			if i%4 == 0 {
				p.Text(track.X, r.Y+barHeight+8, fmt.Sprintf("%02d", i), 10, c.Theme().TextMuted)
			}
		}
		m.known = true
	})
	caption := a.tr("移动鼠标或使用方向键查看每小时用量")
	detail := " "
	if selected >= 0 {
		h := hours[selected]
		caption = fmt.Sprintf("%02d:00–%02d:00 · %s tokens", selected, selected+1, compact(number(h["total"])))
		detail = full(number(h["requests"])) + " " + a.tr("用量记录")
	}
	ui.Column(c).MinHeight(36).Shrink(0).Gap(4).Children(func() {
		ui.Text(c, caption).FontSize(11).TextColor(c.Theme().Accent)
		ui.Text(c, detail).FontSize(10).TextColor(c.Theme().TextMuted)
	})
}
