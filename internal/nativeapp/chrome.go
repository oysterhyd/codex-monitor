package nativeapp

import (
	"fmt"
	"github.com/egoist/mygo/ui"
	"time"
)

func (a *App) header(c *ui.Context) {
	width, _ := c.Size()
	navWidth := float32(584)
	if width < 1200 {
		navWidth = 490
	}
	ui.Row(c).Height(76).DragWindow().Label(a.tr("拖动窗口")).Padding(0, 28).Gap(14).AlignItems(ui.Center).Gradient(c.Theme().Background.Alpha(.65), softAccent(c).Alpha(.67), 120).BorderWidth(0, 0, 1, 0).BorderColor(edge(c)).Children(func() {
		ui.Row(c).Grow(1).Basis(0).MinWidth(160).Gap(10).Children(func() {
			if a.brand != nil {
				ui.Image(c, a.brand).Size(35, 35).Radius(11)
			}
			ui.Text(c, "Codex Monitor").FontSize(16).FontWeight(650)
		})
		labels := []string{a.tr("总览"), a.tr("活动"), a.tr("历史分析"), a.tr("账户额度"), a.tr("设置与价格")}
		previous := a.page
		segment(c, &a.page, labels, []string{"pulse", "calendar", "history", "chart", "settings"}, navWidth, 48).Radius(14).Border(1, edge(c)).Label(a.tr("主导航"))
		if previous != a.page {
			a.generation++
			a.load()
		}
		ui.Row(c).Grow(1).Basis(0).MinWidth(240).Gap(9).Justify(ui.End).Children(func() {
			b := button(c, "").Label(a.tr("打开命令面板")).Padding(7, 8)
			b.Children(func() {
				icon(c, "search", 16)
				ui.Text(c, "Ctrl K").FontSize(10).Border(1, c.Theme().Border).Radius(4).Padding(1, 4)
			})
			if b.Clicked() {
				a.commandOpen = true
			}
			ui.Row(c).Height(35).Padding(0, 8).Gap(7).Radius(9).Background(c.Theme().Surface.Alpha(.5)).Children(func() {
				icon(c, "widget", 15)
				ui.Text(c, a.tr("小组件"))
				on := a.widgetMode
				if ui.Switch(c, &on).Label(a.tr("桌面小组件模式")).Disabled(a.busy).Changed() {
					a.toggleWidget()
				}
			})
			if width >= 1200 {
				scan := obj(a.data["scan"])
				label := "等待数据源"
				color := ui.Hex("#926018")
				if truth(scan["sourceExists"]) {
					label = "采集运行中"
					color = c.Theme().Accent
				}
				ui.Row(c).Gap(7).Children(func() {
					ui.Box(c).Size(6, 6).Radius(3).Background(color)
					ui.Text(c, a.tr(label)).FontSize(11).TextColor(c.Theme().TextMuted)
				})
			}
			if iconButton(c, "refresh", a.tr("刷新数据与额度")).Disabled(a.busy).Clicked() {
				a.action("refresh", nil, "数据已刷新")
			}
		})
	})
}
func (a *App) title(c *ui.Context) {
	ui.Row(c).Key("title-" + pageIDs[a.page]).Transition(enterMotion(a.pageEnterX, 7)).Height(35).Shrink(0).Gap(15).Children(func() {
		ui.Text(c, a.tr(pageNames[a.page])).FontSize(17).FontWeight(650)
		context := ""
		if a.page == 1 {
			context = str(obj(a.data["activity"])["year"])
		} else if a.page == 4 {
			context = "v" + str(a.data["version"])
		} else if len(a.data) > 0 {
			end := dateValue(str(obj(a.data["range"])["end"]))
			context = shortStamp(obj(a.data["range"])["start"]) + " — " + shortStamp(end.UnixMilli()-1)
		}
		ui.Text(c, context).FontSize(11).Padding(0, 0, 0, 15).BorderWidth(0, 0, 0, 1).BorderColor(c.Theme().Border).TextColor(c.Theme().TextMuted)
		ui.Spacer(c)
		if a.page != 4 {
			b := button(c, "").Label(a.tr("导出 CSV")).Disabled(a.busy || a.loading || len(a.data) == 0)
			b.Children(func() { icon(c, "export", 16); ui.Text(c, a.tr("导出 CSV")) })
			if b.Clicked() {
				a.exportCSV()
			}
		}
	})
}
func (a *App) filters(c *ui.Context) {
	ui.Row(c).Height(35).Gap(8).Children(func() {
		if a.page != 1 {
			index := 0
			ids := []string{"today", "7d", "30d", "all", "custom"}
			for i, id := range ids {
				if str(a.filter["range"]) == id {
					index = i
				}
			}
			previous := index
			segment(c, &index, []string{a.tr("今日"), a.tr("近 7 天"), a.tr("近 30 天"), a.tr("全部"), a.tr("自定义")}, nil, 345, 35).Label(a.tr("时间范围"))
			if previous != index {
				if ids[index] == "custom" {
					a.customOpen = true
				} else {
					a.customOpen = false
					a.change("range", ids[index])
				}
			}
		} else {
			ui.Text(c, a.tr("活动筛选")).TextColor(c.Theme().TextMuted)
		}
		ui.Spacer(c)
		ids := []string{"", "current"}
		labels := []string{a.tr("全部账号"), a.tr("当前账号") + " · " + a.accountLabel(str(a.data["currentAccount"]))}
		if a.page == 3 {
			ids = ids[1:]
			labels = labels[1:]
			if str(a.filter["account"]) == "" {
				ids[0] = ""
			}
		}
		for _, account := range objects(a.data["accounts"]) {
			ids = append(ids, str(account["id"]))
			labels = append(labels, str(account["label"]))
		}
		ids = append(ids, "unassigned")
		labels = append(labels, a.tr("未归属"))
		if id, changed := a.selectKey(c, "账号筛选", str(a.filter["account"]), ids, labels, 185); changed {
			a.quotaIndex = 0
			a.change("account", id)
		}
		if a.page != 3 {
			for _, entry := range []struct{ key, opt, label string }{{"model", "models", "全部模型"}, {"project", "projects", "全部项目"}} {
				items := stringsOf(obj(a.data["options"])[entry.opt])
				ids := append([]string{""}, items...)
				labels := []string{a.tr(entry.label)}
				for _, s := range items {
					if entry.key == "project" {
						labels = append(labels, shortPath(s))
					} else {
						labels = append(labels, s)
					}
				}
				w := float32(125)
				if entry.key == "project" {
					w = 90
				}
				if id, changed := a.selectKey(c, entry.label, str(a.filter[entry.key]), ids, labels, w); changed {
					a.change(entry.key, id)
				}
			}
		}
	})
	active := false
	for _, key := range []string{"model", "project", "session"} {
		if str(a.filter[key]) != "" {
			active = true
		}
	}
	if active {
		ui.Row(c).Gap(7).Children(func() {
			for _, key := range []string{"model", "project", "session"} {
				if value := str(a.filter[key]); value != "" {
					if button(c, value+"  ×").Height(26).FontSize(11).Background(softAccent(c)).TextColor(c.Theme().Accent).Clicked() {
						a.change(key, "")
					}
				}
			}
			if button(c, a.tr("清除筛选")).Clicked() {
				for _, key := range []string{"model", "project", "session"} {
					delete(a.filter, key)
				}
				a.generation++
				a.load()
			}
		})
	}
}
func (a *App) summaryStrip(c *ui.Context) {
	s := obj(a.data["sums"])
	primary := Object{}
	for _, q := range objects(a.data["quotas"]) {
		if number(q["minutes"]) == 300 {
			primary = q
			break
		}
	}
	var remaining any
	foot := a.tr("尚未获得额度快照")
	if primary["used"] != nil {
		remaining = 100 - number(primary["used"])
		foot = a.tr("{0} 小时窗口", number(primary["minutes"])/60)
	}
	tokenLabel := "Token 消耗"
	if str(a.filter["range"]) == "today" {
		tokenLabel = "今日 Token"
	}
	cost := any(s["cost"])
	if number(s["unpriced"]) == number(s["requests"]) && number(s["requests"]) > 0 {
		cost = nil
	}
	costFoot := a.tr("按标准短上下文价格估算")
	if number(s["unpriced"]) > 0 {
		costFoot = a.tr("{0} 条未定价 · 金额不完整", s["unpriced"])
	}
	ui.Row(c).Height(123).Shrink(0).Gap(0).Radius(17).Gradient(c.Theme().Surface, c.Theme().Surface.Alpha(.65), 135).Border(1, edge(c)).Clip().Children(func() {
		for i, v := range []struct {
			label, foot, icon string
			value             any
			format            func(any) string
			click             func()
		}{{"账户剩余额度", foot, "target", remaining, func(v any) string {
			if v == nil {
				return "—"
			}
			return fmt.Sprintf("%.0f%%", number(v))
		}, func() { a.navigate(3) }},
			{tokenLabel, a.tr("{0} 次用量记录", full(s["requests"])), "stack", s["total"], compact, func() { a.viewIndex = 2; a.navigate(2) }},
			{"API 等值估算 · USD", costFoot, "coins", cost, money, func() { a.settingsSection = 2; a.navigate(4) }},
			{"缓存命中率", a.tr("{0} 缓存输入 tokens", compact(s["cached"])), "lightning", s["cacheRate"], ratio, func() { a.viewIndex = 0; a.navigate(2) }}} {
			color := c.Theme().Accent
			if i == 2 {
				color = ui.Hex("#926018")
			}
			if i == 3 {
				color = ui.Hex("#416bd3")
			}
			cell := ui.Column(c).Key(i).Grow(1).Basis(0).FillHeight().Padding(17, 22).Gap(5).Focusable().Label(a.tr(v.label))
			if i < 3 {
				cell.BorderWidth(0, 1, 0, 0).BorderColor(c.Theme().Border)
			}
			if cell.Hovered() {
				cell.Background(softAccent(c).Alpha(.4))
			}
			cell.Children(func() {
				ui.Row(c).Gap(9).Children(func() {
					ui.Icon(c, icons[v.icon]).Size(16, 16).TextColor(color)
					ui.Text(c, a.tr(v.label)).FontSize(12).TextColor(c.Theme().TextMuted)
				})
				animatedValue(c, "value", v.value, v.format, true).FontSize(32).FontWeight(560).LetterSpacing(-1.2).FontFeatures("tnum")
				ui.Text(c, v.foot).FontSize(11).TextColor(c.Theme().TextMuted)
			})
			if cell.Clicked() || cell.Shortcut(0, ui.KeyEnter) {
				v.click()
			}
		}
	})
}
func shortStamp(v any) string {
	if v == nil || str(v) == "" {
		return "—"
	}
	var t time.Time
	switch v.(type) {
	case float64, int, int64:
		t = time.UnixMilli(int64(number(v)))
	default:
		t = dateValue(str(v))
	}
	if t.IsZero() {
		return str(v)
	}
	return t.Local().Format("01/02 15:04")
}
func (a *App) customDates(c *ui.Context) {
	ui.Row(c).Key("custom-dates").Transition(enterMotion(0, 5)).Padding(12).Gap(10).Radius(11).Border(1, c.Theme().Border).Background(c.Theme().Surface.Alpha(.48)).Children(func() {
		icon(c, "calendar", 16)
		ui.Text(c, a.tr("开始日期")).FontSize(11)
		ui.DateInput(c, &a.startDate).Label(a.tr("开始日期"))
		ui.Text(c, "—")
		ui.Text(c, a.tr("结束日期")).FontSize(11)
		ui.DateInput(c, &a.endDate).Label(a.tr("结束日期"))
		invalid := a.startDate.Format("2006-01-02") > a.endDate.Format("2006-01-02")
		if button(c, a.tr("应用日期")).Disabled(invalid).Clicked() {
			a.filter["start"] = a.startDate.Format("2006-01-02")
			a.filter["end"] = a.endDate.Format("2006-01-02")
			a.change("range", "custom")
		}
	})
}
