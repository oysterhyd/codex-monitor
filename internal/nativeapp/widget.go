package nativeapp

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"time"
)

type widgetHost struct {
	cmd      *exec.Cmd
	in       io.WriteCloser
	listener *net.TCPListener
	write    sync.Mutex
	pending  [][]byte
	once     sync.Once
	done     chan struct{}
}

func (h *widgetHost) send(value any) {
	b, _ := json.Marshal(value)
	b = append(b, '\n')
	h.write.Lock()
	defer h.write.Unlock()
	if h.in == nil {
		h.pending = append(h.pending, b)
		return
	}
	_, _ = h.in.Write(b)
}
func (h *widgetHost) hide()   { h.send(Object{"event": "hide"}) }
func (h *widgetHost) update() { h.send(Object{"event": "update"}) }
func (h *widgetHost) close() {
	h.once.Do(func() {
		h.send(Object{"event": "close"})
		h.write.Lock()
		if h.in != nil {
			_ = h.in.Close()
		}
		h.write.Unlock()
		_ = h.listener.Close()
		select {
		case <-h.done:
		case <-time.After(3 * time.Second):
			_ = h.cmd.Process.Kill()
		}
	})
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
	if a.widget != nil {
		a.widget.send(Object{"event": "show"})
		a.widgetMode = true
		a.win.Hide()
		a.updateTray()
		return
	}
	root := a.options.Root
	if root == "" {
		root = filepath.Join(executableRoot(), "widget")
	}
	electron := os.Getenv("MONITOR_ELECTRON")
	if electron == "" {
		for _, p := range []string{filepath.Join(root, "runtime", "electron.exe"), filepath.Join(root, "node_modules", "electron", "dist", "electron.exe")} {
			if _, e := os.Stat(p); e == nil {
				electron = p
				break
			}
		}
	}
	if electron == "" {
		a.errorText = "未找到小组件运行时，请使用 npm run native:start 或完整 native 构建目录。"
		return
	}
	if _, e := os.Stat(filepath.Join(root, "dist", "index.html")); e != nil {
		a.errorText = "小组件界面尚未构建，请执行 npm run build。"
		return
	}
	listener, e := net.ListenTCP("tcp", &net.TCPAddr{IP: net.IPv4(127, 0, 0, 1), Port: 0})
	if e != nil {
		a.errorText = e.Error()
		return
	}
	_ = listener.SetDeadline(time.Now().Add(10 * time.Second))
	tokenBytes := make([]byte, 32)
	if _, e = rand.Read(tokenBytes); e != nil {
		_ = listener.Close()
		a.errorText = e.Error()
		return
	}
	token := hex.EncodeToString(tokenBytes)
	config, _ := json.Marshal(Object{"data": a.options.Data, "port": listener.Addr().(*net.TCPAddr).Port, "token": token, "diagnostics": a.options.Smoke})
	cmd := exec.Command(electron, filepath.Join(root, "electron", "native-widget.cjs"), string(config))
	hideProcess(cmd)
	cmd.Env = filteredEnvironment()
	cmd.Stdout = io.Discard
	cmd.Stderr = io.Discard
	if e = cmd.Start(); e != nil {
		_ = listener.Close()
		a.errorText = e.Error()
		return
	}
	host := &widgetHost{cmd: cmd, listener: listener, done: make(chan struct{})}
	a.widget = host
	a.widgetMode = true
	a.win.Hide()
	a.updateTray()
	go func() {
		defer close(host.done)
		conn, e := listener.AcceptTCP()
		_ = listener.Close()
		if e != nil {
			_ = cmd.Process.Kill()
			_ = cmd.Wait()
			a.win.Update(func() {
				if a.widget == host {
					a.widget = nil
					a.errorText = "小组件连接失败"
					a.restore()
				}
			})
			return
		}
		_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
		scanner := bufio.NewScanner(conn)
		scanner.Buffer(make([]byte, 65536), 4<<20)
		var hello struct {
			Token string `json:"token"`
		}
		if !scanner.Scan() || json.Unmarshal(scanner.Bytes(), &hello) != nil || hello.Token != token {
			_ = conn.Close()
			_ = cmd.Process.Kill()
			_ = cmd.Wait()
			a.win.Update(func() { a.widget = nil; a.errorText = "小组件连接验证失败"; a.restore() })
			return
		}
		_ = conn.SetReadDeadline(time.Time{})
		host.write.Lock()
		host.in = conn
		for _, b := range host.pending {
			_, _ = conn.Write(b)
		}
		host.pending = nil
		host.write.Unlock()
		for scanner.Scan() {
			var message struct {
				ID     int             `json:"id"`
				Method string          `json:"method"`
				Args   json.RawMessage `json:"args"`
				Event  string          `json:"event"`
				Data   string          `json:"data"`
			}
			if json.Unmarshal(scanner.Bytes(), &message) != nil {
				continue
			}
			switch message.Event {
			case "restore":
				a.win.Update(func() { a.restore() })
			case "hidden":
				a.win.Update(func() { a.widgetMode = false; a.updateTray() })
			case "error":
				a.win.Update(func() { a.errorText = "小组件启动失败"; a.restore() })
			}
			if message.ID != 0 {
				go func() {
					if message.Method != "widget" && message.Method != "refresh" {
						host.send(Object{"id": message.ID, "error": "未知操作"})
						return
					}
					ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
					defer cancel()
					result, e := a.client.Call(ctx, message.Method, message.Args)
					if e != nil {
						host.send(Object{"id": message.ID, "error": e.Error()})
					} else {
						host.send(Object{"id": message.ID, "result": result})
						if message.Method == "widget" {
							a.win.Update(func() { a.widgetVerified = true })
						}
					}
				}()
			}
		}
		_ = conn.Close()
		e = cmd.Wait()
		a.win.Update(func() {
			if a.widget == host {
				a.widget = nil
				if a.widgetMode {
					a.restore()
				}
				if e != nil && !a.quitting {
					a.errorText = fmt.Sprintf("小组件已退出：%v", e)
				}
			}
		})
	}()
}
