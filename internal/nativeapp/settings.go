package nativeapp

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/plugins/updater"
	"github.com/egoist/mygo/ui"
)

func (a *App) setting(key string, value any) {
	a.perform(func() (any, error) {
		if key == "autoStart" && !a.options.Offline {
			if err := mygo.App.SetOpenAtLogin(truth(value)); err != nil {
				return nil, err
			}
		}
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		return a.client.Call(ctx, "settings", Object{key: value})
	}, "")
}

func (a *App) telemetrySettings(c *ui.Context, settings Object) {
	panel(c, a.tr("本机首字采集"), "", func() {
		ui.Row(c).AlignItems(ui.Center).Gap(18).Children(func() {
			ui.Column(c).Grow(1).Gap(5).Children(func() {
				ui.Text(c, a.tr("记录逐次首字时间与失败重试")).FontWeight(600)
				ui.Text(c, a.tr("保留 Desktop、CLI 和 Pi 用量采集；额外接收本机请求诊断，不保存对话、工具内容或登录凭据。")).FontSize(11).TextColor(c.Theme().TextMuted)
			})
			enabled := truth(settings["telemetryEnabled"])
			if ui.Switch(c, &enabled).Label(a.tr("本机首字采集")).Disabled(a.busy).Changed() {
				a.setting("telemetryEnabled", enabled)
			}
		})
		if a.telemetryPortDraft == "" {
			a.telemetryPortDraft = str(settings["telemetryPort"])
		}
		ui.Row(c).AlignItems(ui.Center).Gap(12).Children(func() {
			ui.Text(c, a.tr("本机端口")).FontSize(12)
			ui.TextInput(c, &a.telemetryPortDraft).Width(90).Height(35).Label(a.tr("本机端口"))
			if ui.Button(c, a.tr("应用端口")).Disabled(a.busy).Clicked() {
				port, err := strconv.Atoi(a.telemetryPortDraft)
				if err != nil || port < 1024 || port > 65535 {
					a.errorText = a.tr("采集端口须为 1024–65535 的整数")
				} else {
					a.setting("telemetryPort", port)
				}
			}
		})
		status := obj(a.data["telemetry"])
		label := "采集未开启"
		if truth(status["listening"]) {
			label = "接收就绪，等待新调用"
			if number(status["ttftSamples"]) > 0 {
				label = "已收到首字数据"
			}
		}
		ui.Text(c, a.tr(label)+" · 127.0.0.1:"+str(settings["telemetryPort"])).FontSize(12)
		if str(status["error"]) != "" {
			ui.Text(c, a.tr(str(status["error"]))).TextColor(c.Theme().Danger).FontSize(12)
		}
		if status["receivedAt"] != nil {
			ui.Text(c, a.tr("最近接收")+" "+shortStamp(status["receivedAt"])).FontSize(11).TextColor(c.Theme().TextMuted)
		}
		ui.Text(c, a.tr("自动配置 Codex Desktop / CLI 和 Pi，无需编辑文件或复制加载命令。")).FontSize(12)
		for _, client := range []string{"codex", "pi"} {
			binding := obj(status[client])
			name := "Codex Desktop / CLI"
			if client == "pi" {
				name = "Pi"
			}
			if str(binding["error"]) != "" {
				ui.Text(c, name+" · "+a.tr(str(binding["error"]))).FontSize(12).TextColor(c.Theme().Danger)
			} else if str(binding["state"]) == "ready" {
				ui.Text(c, name+" · "+a.tr("已自动配置")).FontSize(12).TextColor(c.Theme().TextMuted)
			}
		}
		if truth(obj(status["codex"])["restartRequired"]) || truth(obj(status["pi"])["restartRequired"]) {
			ui.Text(c, a.tr("配置已更新：正在运行的 Codex Desktop / CLI 需重启一次；Pi 可执行 /reload。之后的新调用自动采集。")).FontSize(12)
		}
		ui.Row(c).Gap(12).Children(func() {
			if ui.Button(c, a.tr("重新检查自动配置")).Disabled(a.busy).Clicked() {
				a.perform(func() (any, error) {
					ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
					defer cancel()
					return a.client.Call(ctx, "telemetrySetup", Object{})
				}, "自动配置已检查")
			}
		})
		ui.Text(c, a.tr("历史日志没有首字时间时无法补算；客户端未导出的内部重试无法观测。")).FontSize(11).TextColor(c.Theme().TextMuted)
	})
}
func (a *App) settings(c *ui.Context) {
	ui.Tabs(c, &a.settingsSection, a.tr("通用"), a.tr("账号"), a.tr("模型价格"), a.tr("数据与存储")).Height(43).Padding(10, 14).BorderWidth(0, 0, 1, 0).BorderColor(c.Theme().Border).Label(a.tr("设置分类"))
	settings := obj(a.data["settings"])
	ui.Column(c).Key(fmt.Sprintf("settings-%d", a.settingsSection)).FillWidth().Gap(18).Transition(enterMotion(0, 5)).Children(func() {
		switch a.settingsSection {
		case 0:
			surface(c, 0, 432, func() {
				panelHeading(c, a.tr("外观与后台"), "")
				ui.Row(c).Height(74).Padding(15, 0).Gap(18).BorderWidth(0, 0, 1, 0).BorderColor(c.Theme().Border).Children(func() {
					ui.Column(c).Grow(1).Gap(4).Children(func() {
						ui.Text(c, a.tr("语言")).FontWeight(600)
						ui.Text(c, a.tr("界面语言立即生效，并在下次启动时保留")).FontSize(11).TextColor(c.Theme().TextMuted)
					})
					if id, changed := a.selectKey(c, "语言", str(settings["language"]), []string{"zh-CN", "en"}, []string{"简体中文", "English"}, 90); changed {
						a.setting("language", id)
					}
				})
				ui.Row(c).Height(66).Padding(15, 0).Gap(18).BorderWidth(0, 0, 1, 0).BorderColor(c.Theme().Border).Children(func() {
					ui.Text(c, a.tr("主题")).FontWeight(600).Grow(1)
					ids := []string{"system", "light", "dark"}
					index := 0
					for i, id := range ids {
						if str(settings["theme"]) == id {
							index = i
						}
					}
					previous := index
					segment(c, &index, []string{a.tr("系统"), a.tr("浅色"), a.tr("深色")}, nil, 218, 35)
					if previous != index {
						a.setting("theme", ids[index])
					}
				})
				for _, entry := range []struct{ key, label, description string }{{"autoStart", "开机启动", "登录 Windows 后静默进入托盘"}, {"muted", "静音额度提醒", "剩余 20% 和 10% 时提醒"}} {
					ui.Row(c).Height(74).Padding(15, 0).Gap(18).BorderWidth(0, 0, 1, 0).BorderColor(c.Theme().Border).Children(func() {
						ui.Column(c).Grow(1).Gap(4).Children(func() {
							ui.Text(c, a.tr(entry.label)).FontWeight(600)
							ui.Text(c, a.tr(entry.description)).FontSize(11).TextColor(c.Theme().TextMuted)
						})
						value := truth(settings[entry.key])
						if ui.Switch(c, &value).Label(a.tr(entry.label)).Disabled(a.busy).Changed() {
							a.setting(entry.key, value)
						}
					})
				}
				ui.Row(c).Height(66).Padding(15, 0).Gap(18).Children(func() {
					ui.Text(c, a.tr("额度查询间隔")).FontWeight(600).Grow(1)
					if id, changed := a.selectKey(c, "额度查询间隔", fmt.Sprint(settings["quotaInterval"]), []string{"60", "120", "300"}, []string{"1" + a.tr("分钟"), "2" + a.tr("分钟"), "5" + a.tr("分钟")}, 75); changed {
						value, _ := strconv.Atoi(id)
						a.setting("quotaInterval", value)
					}
				})
			}).Gap(0)
			panel(c, a.tr("软件更新"), "", func() {
				ui.Row(c).AlignItems(ui.Center).Gap(16).Children(func() {
					ui.Column(c).Grow(1).Gap(5).Children(func() {
						ui.Text(c, a.tr("当前版本")+" "+appVersion).FontWeight(600)
						ui.Text(c, a.tr("手动检查 GitHub 正式版本，下载后验证签名。更新保留监测数据与设置。")).FontSize(11).TextColor(c.Theme().TextMuted)
					})
					if ui.Button(c, a.tr("检查更新")).Clicked() {
						updater.CheckForUpdates()
					}
				})
			})
			a.telemetrySettings(c, settings)
		case 1:
			panel(c, a.tr("账号管理"), "", func() {
				ui.Text(c, a.tr("自动识别本机登录账号；仅保存账号标识摘要和显示名称，不保存登录凭据。可添加历史账号并修改显示名称。"))
				ui.Row(c).Gap(14).Children(func() {
					ui.TextInput(c, &a.newAccount).Width(360).Label(a.tr("账号名称")).Placeholder(a.tr("账号名称"))
					if ui.PrimaryButton(c, a.tr("添加账号")).Disabled(a.busy || strings.TrimSpace(a.newAccount) == "").Clicked() {
						label := a.newAccount
						a.actionWith("account", Object{"label": label}, "账号已保存", func() { a.newAccount = "" })
					}
				})
				for _, account := range objects(a.data["accounts"]) {
					id := str(account["id"])
					ui.Row(c).Key(id).Gap(14).AlignItems(ui.Center).Children(func() {
						value, exists := a.accountDrafts[id]
						if !exists {
							value = str(account["label"])
						}
						if ui.TextInput(c, &value).Width(360).Label(a.tr("账号名称") + " " + id[:min(6, len(id))]).Changed() {
							a.accountDrafts[id] = value
						}
						ui.Text(c, id[:min(6, len(id))]).Width(100)
						if id == str(a.data["currentAccount"]) {
							ui.Text(c, a.tr("当前登录")).Grow(1)
						} else {
							ui.Box(c).Grow(1)
						}
						if ui.Button(c, a.tr("保存")).Disabled(a.busy || value == str(account["label"]) || strings.TrimSpace(value) == "").Clicked() {
							a.action("account", Object{"id": id, "label": value}, "账号已保存")
						}
					})
				}
			})
		case 2:
			a.prices(c)
		case 3:
			panel(c, a.tr("数据来源"), "", func() {
				paths := obj(a.data["paths"])
				for _, entry := range [][2]string{{"Codex 数据目录", "home"}, {"pi 会话目录", "piSessions"}, {"监测数据库目录", "data"}} {
					ui.Column(c).Gap(5).Children(func() {
						ui.Text(c, a.tr(entry[0])).Bold()
						value := str(paths[entry[1]])
						if value == "" {
							value = "—"
						}
						ui.Text(c, value).Selectable().TextColor(c.Theme().TextMuted)
					})
				}
				ui.Text(c, a.tr("自动统计 pi 中官方登录的 Codex 用量，不含 API Key 和其他供应商。历史账号无法确认时保留为未归属，不改变额度查询来源。"))
				ui.Text(c, a.tr("额度查询程序")).Bold()
				program := str(settings["codexExecutable"])
				if program == "" {
					program = a.tr("自动发现本机 Codex App Server")
				}
				ui.Text(c, program).Selectable()
				ui.Row(c).Gap(12).Children(func() {
					if ui.Button(c, a.tr("选择 codex.exe")).Disabled(a.busy).Clicked() {
						a.perform(func() (any, error) {
							paths, err := mygo.Dialog.Open(mygo.OpenDialogOptions{Parent: a.win, Title: a.tr("选择 codex.exe"), Filters: []mygo.FileFilter{{Name: "Codex executable", Extensions: []string{"exe"}}}})
							if err != nil || len(paths) == 0 {
								return nil, err
							}
							ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
							defer cancel()
							return a.client.Call(ctx, "settings", Object{"codexExecutable": paths[0]})
						}, "查询程序已更新")
					}
					if ui.Button(c, a.tr("恢复自动发现")).Disabled(a.busy).Clicked() {
						a.setting("codexExecutable", "")
					}
					if ui.Button(c, a.tr("打开数据目录")).Clicked() {
						go func() { _ = mygo.Shell.OpenPath(a.options.Data) }()
					}
				})
			})
			panel(c, a.tr("数据与存储"), "", func() {
				ui.Text(c, a.tr("所有数据留在本机，无遥测、无跨设备同步；清空历史仅删除监测数据，保留价格与设置。"))
				if ui.Button(c, a.tr("清空监测历史")).Disabled(a.busy).Clicked() {
					a.perform(func() (any, error) {
						r, err := mygo.Dialog.Message(mygo.MessageOptions{Parent: a.win, Type: mygo.MessageWarning, Title: a.tr("清空监测历史"), Message: a.tr("删除本应用已采集的用量和额度历史？"), Detail: a.tr("Codex 与 pi 原始文件不会被修改。仅继续采集此刻之后的数据；已有历史不会自动重新导入。价格和设置保留。"), Buttons: []string{a.tr("取消"), a.tr("清空历史")}, DefaultButton: 0, CancelButton: 0})
						if err != nil || r.Button != 1 {
							return nil, err
						}
						ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
						defer cancel()
						return a.client.Call(ctx, "clear", nil)
					}, "监测历史已清空")
				}
				if recovery := a.data["recovery"]; recovery != nil {
					b, _ := json.Marshal(recovery)
					ui.Text(c, string(b)).Selectable().FontSize(12)
				}
			})
		}
	})
}
func (a *App) prices(c *ui.Context) {
	panel(c, a.tr("模型价格"), a.tr("USD / 百万 tokens"), func() {
		ui.Text(c, a.tr("按 API 标准价估算，不代表订阅账单。"))
		for _, keys := range [][]string{{"model", "effective"}, {"input", "cached", "output", "cache_write"}} {
			ui.Row(c).Gap(14).Children(func() {
				for _, key := range keys {
					labels := map[string]string{"model": "模型", "effective": "生效时间", "input": "输入", "cached": "缓存输入", "output": "输出", "cache_write": "缓存写入"}
					ui.Column(c).Grow(1).Gap(6).Children(func() {
						ui.Text(c, a.tr(labels[key]))
						value := a.priceForm[key]
						if ui.TextInput(c, &value).Label(a.tr(labels[key])).Changed() {
							a.priceForm[key] = value
						}
					})
				}
			})
		}
		ui.Text(c, "YYYY-MM-DDTHH:mm · "+a.tr("本地时间")).FontSize(12).TextColor(c.Theme().TextMuted)
		ui.Row(c).Gap(12).Children(func() {
			label := "新增价格版本"
			if a.priceID != nil {
				label = "更新价格版本"
			}
			if ui.PrimaryButton(c, a.tr(label)).Disabled(a.busy).Clicked() {
				a.savePrice()
			}
			if ui.Button(c, a.tr("取消编辑")).Clicked() {
				a.resetPrice()
			}
		})
		for _, price := range objects(a.data["prices"]) {
			ui.Column(c).Key(str(price["id"])).Gap(8).Padding(12).BorderWidth(0, 0, 1, 0).BorderColor(c.Theme().Border).Children(func() {
				ui.Row(c).Gap(14).Children(func() {
					ui.Text(c, str(price["model"])+" · v"+str(price["id"])).Bold().Width(260)
					ui.Text(c, stamp(price["effective"])).Width(160)
					ui.Text(c, a.system(str(price["source"]))).Grow(1)
					if str(price["source"]) == "手动设置" && !truth(price["retired"]) {
						if ui.Button(c, a.tr("编辑")).Disabled(a.busy).Clicked() {
							a.editPrice(price, true)
						}
						if ui.Button(c, a.tr("删除")).Disabled(a.busy).Clicked() {
							a.deletePrice(price)
						}
					}
					if ui.Button(c, a.tr("用作模板")).Clicked() {
						a.editPrice(price, false)
					}
				})
				ui.Text(c, fmt.Sprintf("%s %s  ·  %s %s  ·  %s %s  ·  %s %s", a.tr("输入"), money(price["input"]), a.tr("缓存输入"), money(price["cached"]), a.tr("输出"), money(price["output"]), a.tr("缓存写入"), money(price["cache_write"]))).FontSize(12).TextColor(c.Theme().TextMuted)
			})
		}
	})
}
func (a *App) resetPrice() {
	a.priceID = nil
	a.priceForm = map[string]string{"model": "", "input": "", "cached": "", "output": "", "cache_write": "0", "effective": "1970-01-01T00:00"}
}
func (a *App) editPrice(price Object, edit bool) {
	for _, key := range []string{"model", "input", "cached", "output", "cache_write"} {
		a.priceForm[key] = str(price[key])
	}
	a.priceForm["effective"] = dateValue(str(price["effective"])).Local().Format("2006-01-02T15:04")
	a.priceID = nil
	if edit {
		a.priceID = price["id"]
	}
}
func (a *App) savePrice() {
	p := Object{"model": strings.TrimSpace(a.priceForm["model"])}
	for _, key := range []string{"input", "cached", "output", "cache_write"} {
		value, err := strconv.ParseFloat(strings.TrimSpace(a.priceForm[key]), 64)
		if err != nil || value < 0 {
			a.errorText = a.tr("价格须为有限的非负数")
			return
		}
		p[key] = value
	}
	effective := dateValue(a.priceForm["effective"])
	if effective.IsZero() {
		a.errorText = a.tr("生效时间无效")
		return
	}
	p["effective"] = effective.UTC().Format(time.RFC3339)
	if a.priceID != nil {
		p["id"] = a.priceID
	}
	a.actionWith("price", p, "价格版本已保存", a.resetPrice)
}
func (a *App) deletePrice(price Object) {
	model, id := str(price["model"]), price["id"]
	a.perform(func() (any, error) {
		r, err := mygo.Dialog.Message(mygo.MessageOptions{Parent: a.win, Type: mygo.MessageWarning, Title: a.tr("删除价格版本"), Message: a.tr("确认删除 {0} 的价格版本 v{1}？", model, id), Detail: a.tr("删除后，相关历史记录可能使用其他价格版本或显示为未定价。"), Buttons: []string{a.tr("取消"), a.tr("删除")}, DefaultButton: 0, CancelButton: 0})
		if err != nil || r.Button != 1 {
			return nil, err
		}
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		return a.client.Call(ctx, "deletePrice", id)
	}, "价格版本已删除")
}
