package monitor

import (
	"context"
	"encoding/json"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestServiceSerialWritesProfileOwnershipAndShutdown(t *testing.T) {
	dir := t.TempDir()
	s, e := Start(Config{Data: dir, Home: dir, Offline: true})
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	if next, e := Start(Config{Data: dir, Home: dir, Offline: true}); e == nil {
		next.Close()
		t.Fatal("second owner admitted")
	}
	var first atomic.Int32
	var group sync.WaitGroup
	for i := 0; i < 32; i++ {
		group.Add(1)
		go func() {
			defer group.Done()
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			r, e := s.Call(ctx, "notice", "same-notice")
			if e != nil {
				t.Error(e)
				return
			}
			if string(r) == "true" {
				first.Add(1)
			}
		}()
	}
	group.Wait()
	if first.Load() != 1 {
		t.Fatalf("duplicate write count: %d", first.Load())
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, e = s.Call(ctx, "notice", "cancelled"); e == nil {
		t.Fatal("cancelled call admitted")
	}
	s.Close()
	if _, e = s.Call(context.Background(), "snapshot", Object{}); e == nil {
		t.Fatal("closed service admitted call")
	}
	if next, e := Start(Config{Data: dir, Home: dir, Offline: true}); e != nil {
		t.Fatal(e)
	} else {
		next.Close()
	}
}
func TestClearBoundaryAndValidation(t *testing.T) {
	s, e := Open(t.TempDir() + "/monitor.sqlite")
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	at := time.Date(2026, 10, 7, 0, 0, 0, 0, time.UTC)
	state := Object{"session": "s", "model": "gpt-5.5"}
	if e = s.addUsage("before", Object{"input_tokens": 100., "output_tokens": 20.}, iso(at.Add(-time.Second)), state, "逐次记录"); e != nil {
		t.Fatal(e)
	}
	if e = s.clear(at); e != nil {
		t.Fatal(e)
	}
	for _, ts := range []time.Time{at.Add(-time.Second), at, at.Add(time.Second)} {
		o := Object{"type": "token_usage_record", "timestamp": iso(ts), "payload": Object{"response_id": iso(ts), "usage": Object{"input_tokens": 100., "output_tokens": 20.}}}
		raw, _ := json.Marshal(o)
		st := clone(state)
		st["source"] = "desktop"
		if e = s.process(o, st, raw); e != nil {
			t.Fatal(e)
		}
	}
	if n := num(s.mustOne("SELECT COUNT(*) n FROM usage")["n"]); n != 1 {
		t.Fatalf("clear boundary resurrected %v records", n)
	}
	if _, e = s.saveSettings(Object{"quotaInterval": 45.}); e == nil {
		t.Fatal("interval validation")
	}
	if _, e = s.savePrice(Object{"model": "bad model"}); e == nil {
		t.Fatal("price validation")
	}
}
