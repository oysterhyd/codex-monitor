package monitor

import (
	"bufio"
	"bytes"
	"fmt"
	"io"
	"path/filepath"
	"testing"
	"time"
)

func benchmarkStore(b *testing.B) (*Store, time.Time) {
	b.Helper()
	s, err := Open(filepath.Join(b.TempDir(), "monitor.sqlite"))
	if err != nil {
		b.Fatal(err)
	}
	b.Cleanup(func() { s.Close() })
	now := time.Date(2026, 10, 7, 12, 0, 0, 0, time.UTC)
	err = s.transaction(func() error {
		for i := 0; i < 100; i++ {
			if err := s.exec("INSERT INTO sessions(id,project,origin,created) VALUES(?,?,?,?)", fmt.Sprint(i), "project", "desktop", iso(now.Add(-24*time.Hour))); err != nil {
				return err
			}
		}
		for i := 0; i < 20000; i++ {
			if err := s.exec("INSERT INTO usage(id,session,ts,model,input,cached,output,account) VALUES(?,?,?,?,?,?,?,?)", fmt.Sprint(i), fmt.Sprint(i%100), iso(now.Add(-time.Duration(i)*time.Second)), "gpt-5", 1000, 400, 200, Unknown); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		b.Fatal(err)
	}
	return s, now
}

func BenchmarkSnapshot(b *testing.B) {
	s, now := benchmarkStore(b)
	for _, page := range []string{"overview", "history", "activity", "settings"} {
		b.Run(page, func(b *testing.B) {
			b.ReportAllocs()
			for i := 0; i < b.N; i++ {
				if _, err := s.Snapshot(Object{"page": page, "range": "all"}, now); err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}

func BenchmarkCostLookup(b *testing.B) {
	for _, count := range []int{13, 1000} {
		b.Run(fmt.Sprint(count), func(b *testing.B) {
			prices := make([]Object, count)
			for i := range prices {
				prices[i] = Object{"model": fmt.Sprintf("model-%d", i%10), "effective": iso(time.Unix(int64(count-i), 0)), "input": 1., "cached": .1, "output": 2., "id": i}
			}
			row := Object{"model": "model-9", "ts": iso(time.Unix(50, 0)), "input": 1000., "cached": 300., "output": 200.}
			pricing := indexPrices(prices)
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				pricing.cost(row)
			}
		})
	}
}

func BenchmarkScanLines(b *testing.B) {
	data := bytes.Repeat(append(bytes.Repeat([]byte("x"), 1023), '\n'), 10000)
	b.SetBytes(int64(len(data)))
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		reader := bufio.NewReaderSize(bytes.NewReader(data), 256*1024)
		var scratch []byte
		for {
			line, err := readScanLine(reader, &scratch)
			if err == io.EOF {
				break
			}
			if err != nil {
				b.Fatal(err)
			}
			interesting.Match(line[:min(180, len(line))])
		}
	}
}
