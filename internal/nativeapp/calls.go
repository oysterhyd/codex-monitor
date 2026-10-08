package nativeapp

import (
	"fmt"
	"github.com/egoist/mygo/ui"
)

func (a *App) calls(c *ui.Context) {
	data := obj(a.data["calls"])
	panel(c, a.tr("逐次调用明细"), a.tr("共 {0} 条", obj(data["pagination"])["total"]), func() {
		ui.Row(c).Gap(12).Children(func() {
			if ui.TextInput(c, &a.callSearch).Placeholder(a.tr("搜索响应、任务、项目或模型")).Label(a.tr("搜索逐次调用")).Height(35).Grow(1).Changed() {
				a.change("callSearch", a.callSearch)
			}
			if id, changed := a.selectKey(c, "调用状态", str(a.filter["callStatus"]), []string{"", "usage", "failed", "retry"}, []string{a.tr("全部记录"), a.tr("用量记录"), a.tr("失败事件"), a.tr("重试事件")}, 110); changed {
				a.change("callStatus", id)
			}
			order := str(a.filter["callOrder"])
			if order == "" {
				order = "newest"
			}
			if id, changed := a.selectKey(c, "调用排序", order, []string{"newest", "oldest", "tokens", "cost", "ttft"}, []string{a.tr("最新优先"), a.tr("最早优先"), a.tr("Token 最多"), a.tr("费用最高"), a.tr("首字最慢")}, 110); changed {
				a.change("callOrder", id)
			}
		})
		a.callSummary(c, obj(data["summary"]), false)
		if len(data) == 0 {
			ui.Text(c, a.tr("正在加载调用明细…")).Padding(18)
			return
		}
		a.callList(c, objects(data["rows"]), false)
		a.callPagination(c, obj(data["pagination"]), false)
	})
	panel(c, a.tr("首字与请求诊断"), "", func() {
		ui.Text(c, a.tr("首字时间为请求发出至首次输出的等待时间；缺失时显示未知。失败与重试是观测到的诊断事件，缺失 Token 的事件不参与费用计算。")).FontSize(12).TextColor(c.Theme().TextMuted)
		telemetry := obj(a.data["telemetry"])
		coverage := obj(a.data["timingCoverage"])
		ui.Text(c, a.tr("已采集首字 {0} 条，已关联用量 {1} 条", coverage["received"], coverage["associated"])).FontSize(11).TextColor(c.Theme().TextMuted)
		if !truth(telemetry["listening"]) {
			ui.Text(c, a.tr("在设置中开启本机首字采集，并配置 Codex 或加载 Pi 扩展后，新调用会记录首字时间。")).FontSize(12)
		}
		if ui.Button(c, a.tr("打开采集设置")).Clicked() {
			a.settingsSection = 0
			a.navigate(4)
		}
	})
}

func (a *App) callSummary(c *ui.Context, s Object, task bool) {
	if len(s) == 0 {
		return
	}
	ui.Row(c).Gap(22).Padding(12, 0).Children(func() {
		for _, item := range []struct{ label, value string }{
			{a.tr("用量记录"), full(s["usageRecords"])},
			{a.tr("失败事件"), full(s["failedEvents"])},
			{a.tr("重试事件"), full(s["retryEvents"])},
			{a.tr("平均首字"), a.ttft(s["avgTtft"])},
			{a.tr("P95 首字"), a.ttft(s["p95Ttft"])},
		} {
			ui.Column(c).Grow(1).Gap(4).Children(func() {
				ui.Text(c, item.label).FontSize(11).TextColor(c.Theme().TextMuted)
				ui.Text(c, item.value).FontSize(17).FontWeight(600)
			})
		}
	})
	ui.Text(c, a.tr("用量首字样本 {0} / {1}", s["ttftSamples"], s["usageRecords"])).FontSize(11).TextColor(c.Theme().TextMuted)
	if task && str(s["largestId"]) != "" {
		ui.Text(c, a.tr("展开记录可查看任务内消耗占比；缓存和推理 Token 已包含在输入和输出中。")).FontSize(11).TextColor(c.Theme().TextMuted)
	}
}

func (a *App) ttft(v any) string {
	if v == nil {
		return a.tr("未知")
	}
	return fmt.Sprintf("%.2f", number(v)/1000) + a.tr(" 秒")
}

func callPercent(v any) string {
	if v == nil {
		return "—"
	}
	return fmt.Sprintf("%.1f%%", number(v)*100)
}

func callMoney(v any) string {
	if v == nil {
		return "—"
	}
	return fmt.Sprintf("$%.6f", number(v))
}

func (a *App) callList(c *ui.Context, rows []Object, task bool) {
	labels := []string{"时间 / 状态", "模型", "首字时间", "输入 / 输出", "等值估算"}
	widths := []float32{2.5, 2, 1.5, 2.2, 1.7}
	ui.Row(c).Height(38).Padding(10, 12).BorderWidth(0, 0, 1, 0).BorderColor(c.Theme().Border).Children(func() {
		for i, label := range labels {
			ui.Text(c, a.tr(label)).Grow(widths[i]).Basis(0).FontSize(12).TextColor(c.Theme().TextMuted)
		}
	})
	state := &a.callState
	if task {
		state = &a.taskCallState
	}
	state.Key = func(i int) any { return str(rows[i]["id"]) }
	state.Selected = &a.selectedCall
	ui.List(c, state, len(rows), func(i int) {
		r := rows[i]
		row := ui.Row(c).Height(82).Padding(12).Gap(8).BorderWidth(0, 0, 1, 0).BorderColor(c.Theme().Border).Focusable().Label(str(r["id"]))
		if row.Hovered() || a.expandedCall == str(r["id"]) {
			row.Background(c.Theme().SurfaceHover)
		}
		row.Children(func() {
			ui.Column(c).Grow(widths[0]).Basis(0).Gap(5).Children(func() {
				ui.Text(c, dateValue(str(r["ts"])).Local().Format("2006-01-02 15:04:05")).FontSize(12).SingleLine()
				status := map[string]string{"usage": "用量记录", "failed": "失败事件", "retry": "重试事件"}[str(r["status"])]
				color := c.Theme().Accent
				if r["status"] == "failed" {
					color = c.Theme().Danger
				}
				if r["status"] == "retry" {
					color = c.Theme().Warning
				}
				ui.Text(c, "● "+a.tr(status)).FontSize(11).TextColor(color)
			})
			ui.Column(c).Grow(widths[1]).Basis(0).Gap(5).Children(func() {
				ui.Text(c, str(r["model"])).AlignSelf(ui.Start).SingleLine().FontSize(12).FontWeight(500).Padding(4, 9).Radius(12).Background(c.Theme().SurfaceHover).Tooltip(str(r["model"]))
				if task && r["sequence"] != nil {
					ui.Text(c, a.tr("第 {0} 次用量", r["sequence"])).FontSize(11).TextColor(c.Theme().TextMuted)
				} else {
					ui.Text(c, shortPath(str(r["project"]))).FontSize(11).SingleLine().TextColor(c.Theme().TextMuted)
				}
			})
			ui.Column(c).Grow(widths[2]).Basis(0).Gap(5).Children(func() {
				color := c.Theme().Accent
				if r["ttft"] == nil {
					color = c.Theme().TextMuted
				} else if number(r["ttft"]) > 5000 {
					color = c.Theme().Warning
				}
				ui.Text(c, a.ttft(r["ttft"])).AlignSelf(ui.Start).FontSize(12).Padding(4, 9).Radius(12).Background(color.Alpha(.09)).TextColor(color)
				if r["status"] != "usage" && str(r["errorLabel"]) != "" {
					ui.Text(c, a.tr(str(r["errorLabel"]))).FontSize(11).TextColor(c.Theme().TextMuted)
				}
			})
			ui.Column(c).Grow(widths[3]).Basis(0).Gap(5).Children(func() {
				value := "—"
				if r["status"] == "usage" {
					value = full(r["input"]) + " / " + full(r["output"])
				}
				ui.Text(c, value).FontSize(13).FontWeight(500)
				if r["status"] == "usage" {
					ui.Text(c, a.tr("缓存命中")+" "+full(r["cached"])).FontSize(11).TextColor(c.Theme().TextMuted)
				} else if r["attempt"] != nil {
					ui.Text(c, a.tr("尝试序号 {0}", r["attempt"])).FontSize(11).TextColor(c.Theme().TextMuted)
				}
			})
			ui.Column(c).Grow(widths[4]).Basis(0).Gap(5).Children(func() {
				value := "—"
				if r["status"] == "usage" {
					if r["cost"] == nil {
						value = a.tr("未定价")
					} else {
						value = fmt.Sprintf("$ %.6f", number(r["cost"]))
					}
				}
				ui.Text(c, value).AlignSelf(ui.Start).FontSize(13).FontWeight(600).Padding(4, 8).Radius(12).Background(c.Theme().SurfaceHover)
				if r["priceInput"] != nil {
					ui.Text(c, fmt.Sprintf("$%s / $%s /M", shortNumber(number(r["priceInput"])), shortNumber(number(r["priceOutput"])))).FontSize(10).TextColor(c.Theme().TextMuted).Tooltip(a.tr("普通输入 / 输出单价；缓存输入按独立价格计算"))
				}
			})
		})
		if row.Clicked() || row.Shortcut(0, ui.KeyEnter) {
			if a.expandedCall == str(r["id"]) {
				a.expandedCall = ""
			} else {
				a.expandedCall = str(r["id"])
			}
		}
	}).Height(float32(min(8, len(rows))) * 82).Label(a.tr("逐次调用列表"))
	if len(rows) == 0 {
		ui.Text(c, a.tr("没有匹配的调用记录")).Padding(20)
	}
	for _, r := range rows {
		if a.expandedCall == str(r["id"]) {
			a.callDetail(c, r, task)
			break
		}
	}
}

func (a *App) callDetail(c *ui.Context, r Object, task bool) {
	ui.Column(c).Key("call-" + str(r["id"])).Padding(16).Gap(8).Radius(10).Background(c.Theme().SurfaceHover).Children(func() {
		ui.Text(c, a.tr("调用详情")).FontWeight(600)
		id := str(r["response_id"])
		if id == "" {
			id = str(r["usage_id"])
		}
		if id == "" {
			id = str(r["id"])
		}
		ui.Text(c, a.tr("响应 / 记录 ID")+": "+id).FontSize(11).SingleLine().Tooltip(id)
		ui.Text(c, a.tr("任务 ID")+": "+str(r["turn"])+" · "+a.tr("会话")+": "+str(r["session"])).FontSize(11).SingleLine()
		if r["status"] == "usage" {
			ui.Text(c, a.tr("缓存命中率")+" "+callPercent(r["cacheRate"])+" · "+a.tr("推理 Token")+" "+full(r["reasoning"])+" · "+a.tr("缓存写入")+" "+full(r["cache_write"])).FontSize(12)
			ui.Text(c, a.tr("首字时间")+" "+a.ttft(r["ttft"])+" · "+a.tr(str(r["timingNote"]))).FontSize(12)
			ui.Text(c, a.tr("输入费用")+" "+callMoney(r["inputCost"])+" · "+a.tr("输出费用")+" "+callMoney(r["outputCost"])+" · "+a.tr("记录方式")+" "+a.system(str(r["kind"]))).FontSize(12)
			if task {
				ui.Text(c, a.tr("任务 Token 占比")+" "+callPercent(r["tokenShare"])+" · "+a.tr("已定价费用占比")+" "+callPercent(r["costShare"])).FontSize(12)
			}
		} else {
			ui.Text(c, a.tr("错误类型")+" "+a.tr(str(r["errorLabel"]))+" · HTTP "+str(r["http_status"])).FontSize(12)
			ui.Text(c, a.tr("此事件没有独立用量，Token 和费用保持未知。")).FontSize(12).TextColor(c.Theme().TextMuted)
		}
	})
}

func (a *App) callPagination(c *ui.Context, p Object, task bool) {
	page, pages := int(number(p["page"])), int(number(p["pages"]))
	if pages <= 1 {
		return
	}
	ui.Row(c).Gap(12).Children(func() {
		if ui.Button(c, a.tr("上一页")).Disabled(page <= 1).Clicked() {
			if task {
				a.detailPage = page - 1
			} else {
				a.callPage = page - 1
			}
			a.generation++
			a.load()
		}
		ui.Text(c, fmt.Sprintf("%d / %d", page, pages)).FontSize(12)
		if ui.Button(c, a.tr("下一页")).Disabled(page >= pages).Clicked() {
			if task {
				a.detailPage = page + 1
			} else {
				a.callPage = page + 1
			}
			a.generation++
			a.load()
		}
	})
}

func (a *App) taskCalls(c *ui.Context, task Object) {
	d := obj(a.data["callDetails"])
	ui.Text(c, a.tr("任务内调用分析")).FontSize(16).FontWeight(600)
	if str(d["session"]) != str(task["session"]) || str(d["turn"]) != str(task["id"]) {
		ui.Text(c, a.tr("正在加载调用明细…"))
		return
	}
	a.callSummary(c, obj(d["summary"]), true)
	a.callList(c, objects(d["rows"]), true)
	a.callPagination(c, obj(d["pagination"]), true)
}
