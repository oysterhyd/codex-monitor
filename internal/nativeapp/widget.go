package nativeapp

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"time"
)

// The widget uses the parent's service and GUI thread, without another process.
type widgetHost struct {
	app                               *App
	window                            *widgetWindow
	model                             widgetModel
	painter                           *widgetPainter
	saved                             widgetPlacement
	cancel                            context.CancelFunc
	closed, fetching, pending, manual bool
	wasAnimating                      bool
	lastPoll                          time.Time
}
type widgetPlacement struct {
	PositionKnown bool `json:"-"`
	X             int  `json:"x"`
	Y             int  `json:"y"`
	Width         int  `json:"width"`
	Height        int  `json:"height"`
	Topmost       bool `json:"topmost"`
	TopmostChoice bool `json:"topmostChoice"`
	Mode          bool `json:"mode"`
}

func (h *widgetHost) persist() {
	h.saved.Width, h.saved.Height = widgetWidth, widgetHeight
	h.saved.TopmostChoice = true
	b, _ := json.Marshal(h.saved)
	_ = os.WriteFile(filepath.Join(h.app.options.Data, "widget-window.json"), b, 0600)
}
func (h *widgetHost) show() {
	h.model.setVisible(true, time.Now())
	h.saved.Mode = true
	h.window.show()
	h.persist()
	h.update()
}
func (h *widgetHost) hide(animate ...bool) {
	h.model.setVisible(false, time.Now())
	h.saved.Mode = false
	h.persist()
	if len(animate) > 0 && animate[0] {
		h.window.wake()
	} else {
		h.model.visibility.duration = 0
		h.window.hide()
	}
}
func (h *widgetHost) close() {
	if h.closed {
		return
	}
	h.closed = true
	h.cancel()
	h.window.close()
}
func (h *widgetHost) update() { h.request(false) }
func (h *widgetHost) request(manual bool) {
	if h.closed || !h.model.Visible {
		return
	}
	if h.fetching {
		h.pending = true
		h.manual = h.manual || manual
		if manual {
			h.model.Busy = true
			h.window.wake()
		}
		return
	}
	h.fetching = true
	h.model.Busy = manual
	h.lastPoll = time.Now()
	h.window.wake()
	go func() {
		ctx, cancel := context.WithTimeout(h.window.context(), 2*time.Minute)
		defer cancel()
		var raw json.RawMessage
		var err error
		if manual {
			_, err = h.app.client.Call(ctx, "refresh", nil)
		}
		if err == nil {
			raw, err = h.app.client.Call(ctx, "widget", nil)
		}
		var data Object
		if err == nil {
			err = json.Unmarshal(raw, &data)
		}
		h.app.win.Update(func() {
			if h.closed {
				return
			}
			h.fetching = false
			h.model.Busy = false
			if err != nil {
				h.model.Error = err.Error()
			} else {
				h.model.Data, h.model.Error = data, ""
				h.app.widgetVerified = true
			}
			h.painter.invalidate()
			h.window.wake()
			if h.pending {
				manual := h.manual
				h.pending, h.manual = false, false
				h.request(manual)
			}
		})
	}()
}
func (h *widgetHost) tick(now time.Time) {
	if h.closed {
		return
	}
	if h.model.Visible && now.Sub(h.lastPoll) >= 3*time.Second {
		h.update()
	}
	active := h.model.animating(now)
	if h.model.dirty || active || h.wasAnimating {
		h.window.present(h.painter.render(now, h.window.scale()))
		if err := h.window.renderFailure(); err != nil {
			h.app.errorText = err.Error()
			h.close()
			h.app.widget = nil
			h.app.restore()
			return
		}
		h.model.dirty = false
	}
	h.wasAnimating = active
	if !h.model.Visible && !h.model.animating(now) {
		h.window.hide()
	}
}
func (h *widgetHost) activate(action string) {
	switch action {
	case "restore":
		h.app.restore()
	case "collapse", "orb":
		if h.model.toggleBusy(time.Now()) {
			return
		}
		h.window.anchor()
		h.model.toggle(time.Now())
		h.window.wake()
	case "refresh":
		h.request(true)
	case "topmost":
		h.saved.Topmost = !h.saved.Topmost
		h.window.topmost(h.saved.Topmost)
		h.persist()
	case "hide":
		h.hide(true)
		h.app.widgetMode = false
		h.app.updateTray()
	}
}
func (a *App) toggleWidget() {
	if a.widgetMode {
		a.restore()
		return
	}
	if a.widgetClosing {
		return
	}
	if a.reduceMotion || !a.win.IsVisible() {
		a.showWidget()
		return
	}
	a.widgetClosing = true
	time.AfterFunc(motionQuick, func() {
		a.win.Update(func() {
			if a.quitting || !a.widgetClosing {
				return
			}
			a.widgetClosing = false
			if a.win.IsVisible() {
				a.showWidget()
			}
		})
	})
}
func (a *App) showWidget() {
	if a.widgetMode {
		a.restore()
		return
	}
	if a.widget == nil {
		h := &widgetHost{app: a, saved: widgetPlacement{Topmost: true}}
		b, _ := os.ReadFile(filepath.Join(a.options.Data, "widget-window.json"))
		_ = json.Unmarshal(b, &h.saved)
		var oldPlacement map[string]any
		if json.Unmarshal(b, &oldPlacement) == nil {
			_, x := oldPlacement["x"]
			_, y := oldPlacement["y"]
			h.saved.PositionKnown = x && y
		}
		if !h.saved.TopmostChoice {
			h.saved.Topmost = true
		}
		h.model = newWidgetModel()
		h.model.ReduceMotion = a.reduceMotion
		h.painter = newWidgetPainter(&h.model, a.brand)
		ctx, cancel := context.WithCancel(context.Background())
		h.cancel = cancel
		w, err := newWidgetWindow(h, ctx)
		if err != nil {
			cancel()
			a.errorText = err.Error()
			return
		}
		h.window = w
		a.widget = h
	}
	a.widget.show()
	a.widgetMode = true
	a.win.Hide()
	a.updateTray()
}
