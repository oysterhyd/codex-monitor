package monitor

import (
	"encoding/json"
	"math"
	"strings"
	"testing"
	"time"
)

func testStore(t *testing.T) *Store {
	t.Helper()
	s, err := Open(t.TempDir() + "/monitor.sqlite")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := s.Close(); err != nil {
			t.Error(err)
		}
	})
	return s
}

func TestAccountFiltersUnknownPricingAndWidgetScope(t *testing.T) {
	s := testStore(t)
	now := time.Date(2026, 10, 7, 12, 0, 0, 0, time.Local)
	ts := iso(now.Add(-10 * time.Second))
	for _, q := range []struct {
		query string
		args  []any
	}{
		{"INSERT INTO sessions VALUES(?,?,?,?)", []any{"session", "project", "Codex Desktop", ts}},
		{"INSERT INTO usage(id,session,ts,model,input,cached,output,account) VALUES(?,?,?,?,?,?,?,?)", []any{"known", "session", ts, "gpt-5.5", 1000, 500, 100, "a"}},
		{"INSERT INTO usage(id,session,ts,model,input,cached,output,account) VALUES(?,?,?,?,?,?,?,?)", []any{"unknown", "session", ts, "unpriced", 2000, 800, 200, "b"}},
	} {
		if err := s.exec(q.query, q.args...); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.set("currentAccount", "a"); err != nil {
		t.Fatal(err)
	}
	if err := s.set("quotaStatus", Object{"account": "b", "ok": true}); err != nil {
		t.Fatal(err)
	}
	for i, account := range []string{"a", "b"} {
		if err := s.addQuota(Object{"limitId": "codex", "primary": Object{"usedPercent": 28. + float64(i)*60, "windowDurationMins": 300.}}, ts, "API", account); err != nil {
			t.Fatal(err)
		}
	}
	all, err := s.Snapshot(Object{"range": "today", "page": "all"}, now)
	if err != nil {
		t.Fatal(err)
	}
	sums := obj(all["sums"])
	for key, want := range map[string]float64{"total": 3300, "input": 3000, "output": 300, "cached": 1300, "requests": 2, "unpriced": 1, "cost": .00575, "saved": .00225, "cacheRate": 1300. / 3000} {
		if math.Abs(num(sums[key])-want) > 1e-10 {
			t.Fatalf("%s: %v != %v", key, sums[key], want)
		}
	}
	filtered, err := s.Snapshot(Object{"range": "today", "page": "overview", "account": "current"}, now)
	if err != nil {
		t.Fatal(err)
	}
	if num(obj(filtered["sums"])["total"]) != 1100 {
		t.Fatal("account filter", filtered["sums"])
	}
	unknown, err := s.Snapshot(Object{"range": "today", "page": "overview", "model": "unpriced"}, now)
	if err != nil {
		t.Fatal(err)
	}
	if num(obj(unknown["sums"])["unpriced"]) != 1 || costOf(Object{"model": "unpriced", "ts": ts}, s.prices())["cost"] != nil {
		t.Fatal("unpriced usage lost its unknown marker")
	}
	w := s.Widget(now)
	if w["usageScope"] != "all" || num(w["total"]) != 3300 || num(w["tps"]) != 5 || w["quotaStatus"] != nil {
		t.Fatal(w)
	}
	quotas := w["quotas"].([]Object)
	if len(quotas) != 1 || num(quotas[0]["used"]) != 28 {
		t.Fatal("widget mixed account quotas", quotas)
	}
	if err := s.set("currentAccount", "b"); err != nil {
		t.Fatal(err)
	}
	if num(s.Widget(now)["total"]) != 3300 {
		t.Fatal("widget usage changed with desktop login")
	}
	csv, err := s.Export(Object{"range": "today", "account": "a"}, now)
	if err != nil {
		t.Fatal(err)
	}
	if len(strings.Split(csv, "\r\n")) != 2 || !strings.Contains(csv, "gpt-5.5") || strings.Contains(csv, "unpriced") {
		t.Fatal("CSV account filter", csv)
	}
	prices, err := s.savePrice(Object{"model": "gpt-5.5", "effective": iso(now.Add(-time.Hour)), "input": 7., "cached": 1., "output": 9., "cache_write": 0.})
	if err != nil {
		t.Fatal(err)
	}
	if cost := costOf(Object{"model": "gpt-5.5", "ts": ts, "input": 1000., "cached": 500., "output": 100.}, prices); math.Abs(num(cost["cost"])-.0049) > 1e-10 {
		t.Fatal("manual price version", cost)
	}
}

func TestEmptyWidgetKeepsUnknownAndSeparatesMidnight(t *testing.T) {
	s := testStore(t)
	now := time.Date(2026, 10, 8, 0, 0, 5, 0, time.Local)
	w := s.Widget(now)
	if w["cacheRate"] != nil || w["change"] != nil || len(w["quotas"].([]Object)) != 0 {
		t.Fatal(w)
	}
	if err := s.exec("INSERT INTO usage(id,ts,input,cached,output,account) VALUES(?,?,?,?,?,?)", "previous", iso(now.Add(-10*time.Second)), 50, 0, 10, Unknown); err != nil {
		t.Fatal(err)
	}
	w = s.Widget(now)
	if num(w["total"]) != 0 || num(w["previous"]) != 60 || num(w["tps"]) != 10./60 || w["cacheRate"] != nil {
		t.Fatal(w)
	}
}

func TestDesktopModernDedupAndLegacyDifferences(t *testing.T) {
	s := testStore(t)
	state := Object{}
	at := time.Date(2026, 10, 7, 1, 0, 0, 0, time.UTC)
	process := func(kind string, payload Object) {
		t.Helper()
		o := Object{"type": kind, "timestamp": iso(at), "payload": payload}
		raw, _ := json.Marshal(o)
		if err := s.process(o, state, raw); err != nil {
			t.Fatal(err)
		}
		at = at.Add(time.Second)
	}
	usage := func(input, output float64) Object {
		return Object{"input_tokens": input, "cached_input_tokens": input / 2, "output_tokens": output, "total_tokens": input + output}
	}
	process("session_meta", Object{"id": "cli", "originator": "Codex CLI"})
	process("token_usage_record", Object{"response_id": "ignored", "usage": usage(9999, 999)})
	process("session_meta", Object{"id": "desktop", "originator": "Codex Desktop"})
	process("turn_context", Object{"model": "gpt-5.5"})
	for _, total := range []Object{usage(100, 20), usage(100, 20), usage(180, 40)} {
		process("event_msg", Object{"type": "token_count", "info": Object{"total_token_usage": total}})
	}
	for i := 0; i < 2; i++ {
		process("token_usage_record", Object{"response_id": "response", "thread_id": "desktop", "usage": usage(200, 50)})
	}
	process("event_msg", Object{"type": "token_count", "info": Object{"total_token_usage": usage(500, 100)}})
	process("token_usage_record", Object{"response_id": "wrong-thread", "thread_id": "other", "usage": usage(9999, 999)})
	r := s.mustOne("SELECT COUNT(*) n,SUM(input) input,SUM(output) output FROM usage")
	if num(r["n"]) != 3 || num(r["input"]) != 380 || num(r["output"]) != 90 {
		t.Fatal("duplicate/CLI usage counted", r)
	}
}
