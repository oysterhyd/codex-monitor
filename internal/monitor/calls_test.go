package monitor

import (
	"context"
	"database/sql"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func telemetryPayload(at time.Time, fields Object) []byte {
	attrs := []Object{}
	for k, v := range fields {
		attrs = append(attrs, Object{"key": k, "value": Object{"stringValue": text(v)}})
	}
	data := Object{"resourceLogs": []Object{{"scopeLogs": []Object{{"logRecords": []Object{{"timeUnixNano": fmt.Sprint(at.UnixNano()), "attributes": attrs, "body": Object{"stringValue": "SECRET PROMPT"}}}}}}}}
	b, _ := json.Marshal(data)
	return b
}

func seedCall(t *testing.T, s *Store, id, session, turn, model, account string, at time.Time, input, cached, output int) {
	t.Helper()
	for _, entry := range []struct {
		q    string
		args []any
	}{
		{"INSERT OR IGNORE INTO sessions(id,project,origin,created,source) VALUES(?,?,'Codex Desktop',?,'desktop')", []any{session, "project", iso(at.Add(-time.Hour))}},
		{"INSERT OR IGNORE INTO turns(id,session,model,started,status,account) VALUES(?,?,?,?,'completed',?)", []any{turn, session, model, iso(at), account}},
		{"INSERT INTO usage(id,session,turn,ts,model,input,cached,output,reasoning,kind,account) VALUES(?,?,?,?,?,?,?,?,20,'逐次记录',?)", []any{id, session, turn, iso(at), model, input, cached, output, account}},
	} {
		if err := s.exec(entry.q, entry.args...); err != nil {
			t.Fatal(err)
		}
	}
}

func TestTelemetryAllowlistRealTTFTAndNoUsageDuplication(t *testing.T) {
	s := testStore(t)
	at := time.Date(2026, 10, 8, 3, 0, 0, 0, time.UTC)
	fields := Object{"event.name": "codex.sse_event", "event.kind": "response.completed", "conversation.id": "session", "model": "gpt-5.5", "ttft_ms": "4800", "input_token_count": "1000", "cached_token_count": "400", "output_token_count": "100", "reasoning_token_count": "20", "user.email": "SECRET EMAIL", "prompt": "SECRET PROMPT", "authorization": "SECRET TOKEN"}
	events, err := decodeTelemetry(telemetryPayload(at, fields))
	if err != nil || len(events) != 1 {
		t.Fatal(events, err)
	}
	if strings.Contains(jsonText(events), "SECRET") {
		t.Fatal("telemetry retained private attributes")
	}
	if err = s.ingestRequestEvents(events); err != nil {
		t.Fatal(err)
	}
	if truth(s.mustOne("SELECT usage_id FROM request_events")["usage_id"]) {
		t.Fatal("associated before usage existed")
	}
	seedCall(t, s, "resp_one", "session", "turn", "gpt-5.5", Unknown, at.Add(20*time.Millisecond), 1000, 400, 100)
	if err = s.reconcileRequestEvents(); err != nil {
		t.Fatal(err)
	}
	if err = s.ingestRequestEvents(events); err != nil {
		t.Fatal(err)
	}
	if num(s.mustOne("SELECT COUNT(*) n FROM usage")["n"]) != 1 || num(s.mustOne("SELECT COUNT(*) n FROM request_events")["n"]) != 1 {
		t.Fatal("batch retry duplicated cost or timing")
	}
	r := s.mustOne("SELECT * FROM request_events")
	if r["usage_id"] != "resp_one" || num(r["ttft"]) != 4800 || r["association"] != "time_tokens" || r["turn"] != "turn" {
		t.Fatal(r)
	}
	rows := s.callRows(Object{}, "0000", "9999", indexPrices(s.prices()))
	if len(rows) != 1 || num(rows[0]["ttft"]) != 4800 || num(rows[0]["total"]) != 1100 {
		t.Fatal(rows)
	}
}

func TestTimingAmbiguityAndResponseIDPrecedence(t *testing.T) {
	s := testStore(t)
	at := time.Date(2026, 10, 8, 3, 0, 0, 0, time.UTC)
	seedCall(t, s, "resp_one", "s", "t", "gpt-5.5", Unknown, at, 1000, 400, 100)
	seedCall(t, s, "resp_two", "s", "t", "gpt-5.5", Unknown, at.Add(100*time.Millisecond), 1000, 400, 100)
	e := Object{"id": "ambiguous", "ts": iso(at), "session": "s", "model": "gpt-5.5", "kind": "completed", "input": 1000, "cached": 400, "output": 100, "ttft": 1, "source": "otel"}
	if err := s.ingestRequestEvents([]Object{e}); err != nil {
		t.Fatal(err)
	}
	if s.mustOne("SELECT usage_id FROM request_events WHERE id='ambiguous'")["usage_id"] != nil {
		t.Fatal("ambiguous timing assigned to a response")
	}
	e = clone(e)
	e["id"], e["response_id"], e["ttft"] = "exact", "resp_two", 0.
	if err := s.ingestRequestEvents([]Object{e}); err != nil {
		t.Fatal(err)
	}
	r := s.mustOne("SELECT usage_id,ttft,association FROM request_events WHERE id='exact'")
	if r["usage_id"] != "resp_two" || num(r["ttft"]) != 0 || r["association"] != "response_id" {
		t.Fatal(r)
	}
}

func TestPiTimingUsesExistingResponseDeduplicationKey(t *testing.T) {
	s := testStore(t)
	at := time.Date(2026, 10, 8, 3, 0, 0, 0, time.UTC)
	state := Object{}
	if err := s.processPi(Object{"type": "session", "id": "pi-session", "timestamp": iso(at), "cwd": "project"}, state); err != nil {
		t.Fatal(err)
	}
	message := Object{"role": "assistant", "provider": "openai-codex", "api": "openai-codex-responses", "model": "gpt-5.5", "responseId": "resp_pi", "stopReason": "stop", "usage": Object{"input": 1000, "cacheRead": 400, "cacheWrite": 0, "output": 100}}
	if err := s.processPi(Object{"type": "message", "id": "entry", "timestamp": iso(at), "message": message}, state); err != nil {
		t.Fatal(err)
	}
	e := Object{"id": "pi-timing", "ts": iso(at), "session": "pi:pi-session", "kind": "completed", "source": "otel", "response_id": "resp_pi", "ttft": 200., "request_key": "pi-request"}
	if err := s.recordRequestEvent(Object{"id": "pi-retry", "ts": iso(at.Add(-time.Second)), "session": "pi:pi-session", "kind": "retry", "source": "otel", "request_key": "pi-request"}); err != nil {
		t.Fatal(err)
	}
	if err := s.ingestRequestEvents([]Object{e}); err != nil {
		t.Fatal(err)
	}
	r := s.mustOne("SELECT usage_id,ttft FROM request_events WHERE id='pi-timing'")
	if r["usage_id"] != "pi:"+hash("response:resp_pi") || num(r["ttft"]) != 200 {
		t.Fatal(r)
	}
	if num(s.mustOne("SELECT COUNT(*) n FROM usage")["n"]) != 1 {
		t.Fatal("Pi timing added usage")
	}
	if s.mustOne("SELECT turn FROM request_events WHERE id='pi-retry'")["turn"] != r["usage_id"] {
		t.Fatal("Pi retry was not associated with its response")
	}
	if err := s.recordRequestEvent(Object{"id": "unsupported-pi-api", "ts": iso(at), "session": "pi:api", "pi_provider": "openai", "kind": "failed", "source": "otel"}); err != nil {
		t.Fatal(err)
	}
	if len(s.mustOne("SELECT 1 FROM request_events WHERE id='unsupported-pi-api'")) != 0 {
		t.Fatal("unrecognized Pi OpenAI login diagnostics counted")
	}
}

func TestCallFiltersTaskSharesPaginationUnknownAndExport(t *testing.T) {
	s := testStore(t)
	at := time.Date(2026, 10, 8, 3, 0, 0, 0, time.UTC)
	seedCall(t, s, "one", "s", "t", "gpt-5.5", "a", at, 1000, 400, 100)
	seedCall(t, s, "two", "s", "t", "unpriced", "a", at.Add(time.Second), 2000, 800, 200)
	seedCall(t, s, "other", "other", "other-turn", "gpt-5.5", "b", at, 99999, 0, 100)
	for _, e := range []Object{
		{"id": "timing", "ts": iso(at), "session": "s", "turn": "t", "response_id": "one", "kind": "completed", "ttft": 220, "source": "otel"},
		{"id": "failure", "ts": iso(at), "session": "s", "turn": "t", "kind": "failed", "http_status": 429, "error_code": "rate_limit", "source": "otel"},
		{"id": "retry", "ts": iso(at), "session": "s", "turn": "t", "kind": "retry", "attempt": 1, "source": "diagnostic"},
	} {
		if err := s.recordRequestEvent(e); err != nil {
			t.Fatal(err)
		}
	}
	// Account attribution for historical diagnostics remains explicit/unknown until observed.
	if err := s.exec("UPDATE request_events SET account='a'"); err != nil {
		t.Fatal(err)
	}
	if err := s.reconcileRequestEvents(); err != nil {
		t.Fatal(err)
	}
	f := Object{"range": "all", "page": "history", "historyMode": "calls", "account": "a", "detailSession": "s", "detailTurn": "t"}
	snapshot, err := s.Snapshot(f, at.Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	calls := obj(snapshot["calls"])
	summary := obj(calls["summary"])
	if num(summary["usageRecords"]) != 2 || num(summary["failedEvents"]) != 1 || num(summary["retryEvents"]) != 1 || num(summary["ttftSamples"]) != 1 || num(summary["total"]) != 3300 || num(summary["unpriced"]) != 1 {
		t.Fatal(summary)
	}
	detail := obj(snapshot["callDetails"])
	rows := detail["rows"].([]Object)
	for _, r := range rows {
		if r["usage_id"] == "one" && mathDifference(num(r["tokenShare"]), 1./3) > 1e-9 {
			t.Fatal(r)
		}
		if r["usage_id"] == "two" && (r["cost"] != nil || r["ttft"] != nil) {
			t.Fatal("invented cost or timing", r)
		}
		if r["status"] == "failed" && (r["input"] != nil || r["cost"] != nil) {
			t.Fatal("failure counted as billed usage", r)
		}
	}
	f["callStatus"] = "failed"
	f["exportMode"] = "calls"
	exported, err := s.Export(f, at.Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	csvData, err := csv.NewReader(strings.NewReader(strings.TrimPrefix(exported, "\uFEFF"))).ReadAll()
	if err != nil || len(csvData) != 2 {
		t.Fatal(csvData, err)
	}
	if !strings.Contains(exported, "http_status") || !strings.Contains(exported, "rate_limit") || strings.Contains(exported, "resp_one") {
		t.Fatal(exported)
	}
	many := make([]Object, 121)
	selected, page := paginateCalls(many, 99, 50)
	if len(selected) != 21 || num(page["page"]) != 3 || num(page["total"]) != 121 {
		t.Fatal(page)
	}
}

func mathDifference(a, b float64) float64 {
	if a > b {
		return a - b
	}
	return b - a
}

func TestDiagnosticCursorPrivacyClearBoundaryAndRecreation(t *testing.T) {
	s := testStore(t)
	home := t.TempDir()
	file := filepath.Join(home, "logs_2.sqlite")
	db, err := sql.Open("sqlite", file)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err = db.Exec("CREATE TABLE logs(id INTEGER PRIMARY KEY,ts INTEGER,ts_nanos INTEGER,target TEXT,feedback_log_body TEXT,thread_id TEXT)"); err != nil {
		t.Fatal(err)
	}
	at := time.Date(2026, 10, 8, 3, 0, 0, 0, time.UTC)
	body := `run_sampling_request{thread_id=session turn_id=turn model=gpt-5.5}: stream disconnected - retrying sampling request (1/5 in 191ms)... retries=1 sampling_error=connection lost SECRET TOKEN`
	if _, err = db.Exec("INSERT INTO logs VALUES(1,?,0,'codex_core::responses_retry',?,'session')", at.Unix(), body); err != nil {
		t.Fatal(err)
	}
	n, status := s.scanRequestDiagnostics(context.Background(), home)
	if n != 1 || !truth(status["available"]) {
		t.Fatal(n, status)
	}
	if strings.Contains(jsonText(s.mustQuery("SELECT * FROM request_events")), "SECRET") {
		t.Fatal("stored raw diagnostic")
	}
	if n, _ = s.scanRequestDiagnostics(context.Background(), home); n != 0 {
		t.Fatal("diagnostic replay duplicated")
	}
	if err = s.clear(at.Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec("UPDATE logs SET ts=? WHERE id=1", at.Add(2*time.Second).Unix()); err != nil {
		t.Fatal(err)
	}
	if n, _ = s.scanRequestDiagnostics(context.Background(), home); n != 1 {
		t.Fatal("recreated database cursor missed a request")
	}
	r := s.mustOne("SELECT * FROM request_events")
	if r["turn"] != "turn" || num(r["attempt"]) != 1 || r["error_code"] != "connection" {
		t.Fatal(r)
	}
	old := Object{"id": "cleared", "ts": iso(at), "session": "session", "kind": "failed", "source": "otel"}
	if err = s.recordRequestEvent(old); err != nil {
		t.Fatal(err)
	}
	if num(s.mustOne("SELECT COUNT(*) n FROM request_events")["n"]) != 1 {
		t.Fatal("cleared telemetry replayed")
	}
}

func TestOTLPHTTPCollectorAcceptsJSONAndRejectsBrowserAndOversizedBodies(t *testing.T) {
	service, err := Start(Config{Data: t.TempDir(), Home: t.TempDir(), Offline: true})
	if err != nil {
		t.Fatal(err)
	}
	defer service.Close()
	server := httptest.NewServer(http.HandlerFunc(service.receiveTelemetry))
	defer server.Close()
	at := time.Now()
	body := telemetryPayload(at, Object{"event.name": "codex.api_request", "conversation.id": "s", "model": "gpt-5.5", "http.response.status_code": 429, "attempt": 1, "error.message": "SECRET bearer token"})
	for _, entry := range []struct {
		body            []byte
		content, origin string
		want            int
	}{
		{body, "application/json", "", 200}, {body, "application/json", "https://example.com", 403}, {body, "application/x-protobuf", "", 415}, {[]byte("{"), "application/json", "", 400}, {[]byte(strings.Repeat("x", (8<<20)+1)), "application/json", "", 413},
	} {
		request, _ := http.NewRequest("POST", server.URL+"/v1/logs", strings.NewReader(string(entry.body)))
		request.Header.Set("Content-Type", entry.content)
		if entry.origin != "" {
			request.Header.Set("Origin", entry.origin)
		}
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		if response.StatusCode != entry.want {
			t.Fatal(response.StatusCode, entry.want)
		}
	}
	data, err := service.Call(context.Background(), "snapshot", Object{"page": "history", "historyMode": "calls", "range": "all"})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), "SECRET") || !strings.Contains(string(data), "rate_limit") {
		t.Fatal(string(data))
	}
}

func TestCollectorPortConflictRollsBackAndShutdownReleasesPort(t *testing.T) {
	s := testStore(t)
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	service := &Service{store: s}
	defer service.stopTelemetry()
	settings := []byte(jsonText(Object{"telemetryEnabled": true, "telemetryPort": port}))
	if _, err = service.handle("settings", settings); err == nil {
		t.Fatal("occupied port accepted")
	}
	if truth(s.settings()["telemetryEnabled"]) || num(s.settings()["telemetryPort"]) != 4319 {
		t.Fatal("failed collector changed settings")
	}
	listener.Close()
	if _, err = service.handle("settings", settings); err != nil {
		t.Fatal(err)
	}
	if !truth(obj(s.get("telemetryStatus"))["listening"]) {
		t.Fatal("collector not listening")
	}
	connection, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", port), time.Second)
	if err != nil {
		t.Fatal(err)
	}
	connection.Close()
	if _, err = service.handle("settings", []byte(`{"telemetryEnabled":false}`)); err != nil {
		t.Fatal(err)
	}
	listener, err = net.Listen("tcp4", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		t.Fatal("collector did not release port", err)
	}
	listener.Close()
}

func TestScanReconcilesEarlyTelemetryWithCLIUsage(t *testing.T) {
	s := testStore(t)
	home := t.TempDir()
	at := time.Date(2026, 10, 8, 3, 0, 0, 0, time.UTC)
	e := Object{"id": "early-cli", "ts": iso(at.Add(time.Second)), "session": "cli-session", "kind": "completed", "model": "gpt-5.5", "ttft": 450, "input": 1000, "cached": 400, "output": 100, "source": "otel"}
	if err := s.ingestRequestEvents([]Object{e}); err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join(home, "sessions")
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	lines := []Object{
		{"type": "session_meta", "timestamp": iso(at), "payload": Object{"id": "cli-session", "originator": "codex-tui", "cwd": "project"}},
		{"type": "event_msg", "timestamp": iso(at), "payload": Object{"type": "task_started", "turn_id": "cli-turn"}},
		{"type": "turn_context", "timestamp": iso(at), "payload": Object{"turn_id": "cli-turn", "model": "gpt-5.5"}},
		{"type": "token_usage_record", "timestamp": iso(at.Add(time.Second)), "payload": Object{"response_id": "resp_cli", "turn_id": "cli-turn", "thread_id": "cli-session", "usage": Object{"input_tokens": 1000, "cached_input_tokens": 400, "output_tokens": 100}}},
	}
	content := ""
	for _, line := range lines {
		// Match Codex's timestamp/type/payload ordering used by the bounded scan prefilter.
		content += fmt.Sprintf("{\"timestamp\":%q,\"type\":%q,\"payload\":%s}\n", line["timestamp"], line["type"], jsonText(line["payload"]))
	}
	if err := os.WriteFile(filepath.Join(dir, "cli.jsonl"), []byte(content), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Scan(context.Background(), home, "", "", true, nil); err != nil {
		t.Fatal(err)
	}
	if row := s.mustOne("SELECT usage_id,turn,ttft FROM request_events"); row["usage_id"] != "resp_cli" || row["turn"] != "cli-turn" || num(row["ttft"]) != 450 {
		t.Fatal(row)
	}
	if s.mustOne("SELECT source FROM sessions")["source"] != "cli" {
		t.Fatal("CLI source was lost")
	}
}
