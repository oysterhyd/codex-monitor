package nativeapp

import (
	"fmt"
	"sort"
	"strings"

	"github.com/egoist/mygo/ui"
)

func (a *App) history(c *ui.Context) {
	a.summaryStrip(c)
	panel(c, a.tr("消耗明细"), a.tr("共 {0} 条", len(objects(a.data[[]string{"models", "projects", "tasks"}[a.viewIndex]]))), func() {
		previous := a.viewIndex
		ui.Row(c).Gap(8).Children(func() {
			segment(c, &a.viewIndex, []string{a.tr("按模型"), a.tr("按项目"), a.tr("按任务")}, nil, 190, 35)
			ui.TextInput(c, &a.breakdownSearch).Placeholder(a.tr("搜索名称")).Label(a.tr("搜索消耗明细")).Height(35).Grow(1)
			sortKeys := []string{"total", "cost", "output", "name"}
			current := a.breakdownSort.Column
			if current == "" {
				current = "total"
			}
			if id, changed := a.selectKey(c, "明细排序", current, sortKeys, []string{a.tr("Token 最多"), a.tr("费用最高"), a.tr("输出最多"), a.tr("名称顺序")}, 100); changed {
				a.breakdownSort.Column = id
				a.breakdownSort.Descending = id != "name"
			}
		})
		if previous != a.viewIndex {
			a.breakdownPage = 1
			a.generation++
			a.load()
		}
		key := []string{"models", "projects", "tasks"}[a.viewIndex]
		var rows []Object
		for _, row := range objects(a.data[key]) {
			if strings.Contains(strings.ToLower(str(row["name"])+" "+str(row["project"])), strings.ToLower(a.breakdownSearch)) {
				rows = append(rows, row)
			}
		}
		column := a.breakdownSort.Column
		if column == "" {
			column = "total"
		}
		descending := a.breakdownSort.Descending
		if a.breakdownSort.Column == "" {
			descending = true
		}
		sort.SliceStable(rows, func(i, j int) bool {
			if column == "name" {
				if descending {
					return str(rows[i]["name"]) > str(rows[j]["name"])
				}
				return str(rows[i]["name"]) < str(rows[j]["name"])
			}
			if descending {
				return number(rows[i][column]) > number(rows[j][column])
			}
			return number(rows[i][column]) < number(rows[j][column])
		})
		pages := max(1, (len(rows)+49)/50)
		a.breakdownPage = max(1, min(a.breakdownPage, pages))
		start := (a.breakdownPage - 1) * 50
		selected := rows[min(start, len(rows)):min(start+50, len(rows))]
		labels := []string{a.tr(map[string]string{"models": "模型", "projects": "项目", "tasks": "任务 ID"}[key]), a.tr("输入"), a.tr("缓存"), a.tr("输出"), a.tr("等值 USD")}
		ui.Row(c).Height(44).Margin(12, 0, 0, 0).Padding(11, 12).BorderWidth(0, 0, 1, 0).BorderColor(c.Theme().Border).Children(func() {
			for i, label := range labels {
				e := ui.Text(c, label).FontSize(12).FontWeight(500).TextColor(c.Theme().TextMuted)
				if i == 0 {
					e.Grow(2).Basis(0)
				} else {
					e.Grow(1).Basis(0).TextAlign(ui.End)
				}
			}
		})
		ui.List(c, &a.historyState, len(selected), func(i int) {
			row := selected[i]
			e := ui.Row(c).Height(45).Padding(11, 12).BorderWidth(0, 0, 1, 0).BorderColor(c.Theme().Border).Focusable().Label(str(row["name"]))
			if e.Hovered() {
				e.Background(c.Theme().SurfaceHover)
			}
			e.Children(func() {
				label := str(row["name"])
				if key == "projects" {
					label = shortPath(label)
				}
				ui.Text(c, label).Grow(2).Basis(0).SingleLine().Tooltip(str(row["name"]))
				for _, key := range []string{"input", "cached", "output"} {
					ui.Text(c, full(row[key])).Grow(1).Basis(0).FontSize(12).TextAlign(ui.End)
				}
				cost := money(row["cost"])
				if number(row["requests"]) > 0 && number(row["requests"]) == number(row["unpriced"]) {
					cost = a.tr("未定价")
				}
				ui.Text(c, cost).Grow(1).Basis(0).FontSize(12).TextAlign(ui.End)
			})
			if e.Clicked() {
				a.change(map[string]string{"models": "model", "projects": "project", "tasks": "session"}[key], str(row["name"]))
			}
		}).Height(float32(min(10, len(selected))) * 45).Label(a.tr("历史分析表格"))
		if len(rows) == 0 {
			ui.Text(c, a.tr("没有匹配的结果")).Padding(24)
		}
		if pages > 1 {
			ui.Row(c).Gap(12).Children(func() {
				if button(c, a.tr("上一页")).Disabled(a.breakdownPage <= 1).Clicked() {
					a.breakdownPage--
				}
				ui.Text(c, fmt.Sprintf("%d / %d", a.breakdownPage, pages))
				if button(c, a.tr("下一页")).Disabled(a.breakdownPage >= pages).Clicked() {
					a.breakdownPage++
				}
			})
		}
	})
	a.performance(c)
	panel(c, a.tr("任务运行记录"), a.tr("共 {0} 条", obj(a.data["records"])["total"]), func() {
		ui.Row(c).Gap(14).Children(func() {
			if ui.TextInput(c, &a.search).Placeholder(a.tr("搜索任务、项目或模型")).Label(a.tr("搜索任务记录")).Height(35).Grow(1).Changed() {
				a.change("recordSearch", a.search)
			}
			if id, changed := a.selectKey(c, "任务状态筛选", str(a.filter["recordStatus"]), []string{"", "completed", "failed", "aborted", "running"}, []string{a.tr("全部状态"), a.tr("已完成"), a.tr("失败"), a.tr("已取消"), a.tr("未结束")}, 95); changed {
				a.change("recordStatus", id)
			}
			current := str(a.filter["recordOrder"])
			if current == "" {
				current = "newest"
			}
			if id, changed := a.selectKey(c, "记录排序", current, []string{"newest", "oldest"}, []string{a.tr("最新优先"), a.tr("最早优先")}, 95); changed {
				a.change("recordOrder", id)
			}
		})
		rows := objects(a.data["turns"])
		a.recordState.Key = func(i int) any { return str(rows[i]["session"]) + ":" + str(rows[i]["id"]) }
		a.recordState.Selected = &a.selectedRecord
		labels := []string{a.tr("开始时间 / 任务"), a.tr("模型"), a.tr("状态"), a.tr("输入 Token"), a.tr("输出 Token"), a.tr("估算费用"), a.tr("耗时"), a.tr("首 Token")}
		widths := []float32{2.6, 1.6, 1, 1, 1, 1.4, 1, 1}
		ui.Row(c).Height(44).Padding(11, 12).BorderWidth(0, 0, 1, 0).BorderColor(c.Theme().Border).Children(func() {
			for i, label := range labels {
				ui.Text(c, label).Grow(widths[i]).Basis(0).FontWeight(500).FontSize(12).TextColor(c.Theme().TextMuted)
			}
		})
		ui.List(c, &a.recordState, len(rows), func(i int) {
			v := rows[i]
			identity := str(v["session"]) + ":" + str(v["id"])
			row := ui.Row(c).Height(75).Padding(11, 12).BorderWidth(0, 0, 1, 0).BorderColor(c.Theme().Border).Focusable().Label(str(v["id"]))
			row.Children(func() {
				ui.Column(c).Grow(widths[0]).Basis(0).Gap(4).Children(func() {
					ui.Text(c, shortStamp(v["started"])).FontSize(12)
					label := str(v["session"])
					ui.Text(c, label[:min(8, len(label))]+" · "+shortPath(str(v["project"]))).FontSize(10).TextColor(c.Theme().TextMuted).SingleLine()
					ui.Text(c, "› "+str(v["id"])).FontSize(10).TextColor(c.Theme().TextMuted).SingleLine()
				})
				ui.Text(c, str(v["model"])).Grow(widths[1]).Basis(0).SingleLine().FontSize(12)
				status := str(v["status"])
				text := map[string]string{"completed": "已完成", "failed": "失败", "aborted": "已取消", "running": "未结束"}[status]
				if text == "" {
					text = status
				}
				color := c.Theme().TextMuted
				if status == "completed" {
					color = c.Theme().Accent
				}
				if status == "failed" {
					color = c.Theme().Danger
				}
				ui.Column(c).Grow(widths[2]).Basis(0).Children(func() {
					ui.Text(c, a.tr(text)).FontSize(10).Padding(3, 7).Radius(5).Background(color.Alpha(.1)).TextColor(color)
				})
				ui.Text(c, full(v["input"])).Grow(widths[3]).Basis(0).FontSize(12)
				ui.Text(c, full(v["output"])).Grow(widths[4]).Basis(0).FontSize(12)
				ui.Column(c).Grow(widths[5]).Basis(0).Gap(3).Children(func() {
					ui.Text(c, a.recordCost(v)).FontSize(12)
					ui.Text(c, a.tr("输入")+" "+money(v["inputCost"])).FontSize(10).TextColor(c.Theme().TextMuted)
				})
				ui.Text(c, a.duration(v["duration"])).Grow(widths[6]).Basis(0).FontSize(12)
				ui.Text(c, a.duration(v["ttft"])).Grow(widths[7]).Basis(0).FontSize(12)
			})
			if row.Clicked() || row.Shortcut(0, ui.KeyEnter) {
				if a.expanded == identity {
					a.expanded = ""
				} else {
					a.expanded = identity
				}
			}
		}).Height(float32(len(rows)) * 75).Label(a.tr("任务运行记录表格"))

		if len(rows) == 0 {
			ui.Text(c, a.tr("这个时间范围内还没有记录"))
		}
		r := obj(a.data["records"])
		page, pages := int(number(r["page"])), int(number(r["pages"]))
		ui.Row(c).Gap(12).Children(func() {
			if ui.Button(c, a.tr("上一页")).Disabled(page <= 1).Clicked() {
				a.recordPage = page - 1
				a.generation++
				a.load()
			}
			ui.Text(c, fmt.Sprintf("%d / %d", page, max(1, pages)))
			if ui.Button(c, a.tr("下一页")).Disabled(page >= pages).Clicked() {
				a.recordPage = page + 1
				a.generation++
				a.load()
			}
		})
		for _, row := range rows {
			if a.expanded == str(row["session"])+":"+str(row["id"]) {
				ui.Column(c).Key(a.expanded).Gap(14).Transition(enterMotion(0, 5)).Children(func() {
					ui.Text(c, str(row["id"])+" · "+str(row["project"])).Bold()
					for _, model := range objects(row["models"]) {
						ui.Row(c).Gap(20).Children(func() {
							ui.Text(c, str(model["model"])).Width(190)
							ui.Text(c, a.tr("输入")+" "+full(model["input"])).Grow(1)
							ui.Text(c, a.tr("缓存输入")+" "+full(model["cached"])).Grow(1)
							ui.Text(c, a.tr("输出")+" "+full(model["output"])).Grow(1)
							ui.Text(c, a.rowCost(model)).Width(160)
						})
					}
					ui.Text(c, a.tr("任务耗时")+" "+a.duration(row["duration"])+" · "+a.tr("首 Token 延迟")+" "+a.duration(row["ttft"]))
				})
			}
		}
	})
}
