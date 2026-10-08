package monitor

import (
	"bytes"
	"encoding/binary"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestRecoverDatabasePreservesTablesAndPendingWAL(t *testing.T) {
	file := pendingWALFixture(t, true)
	before := map[string][]byte{}
	for _, suffix := range []string{"", "-wal"} {
		var err error
		before[suffix], err = os.ReadFile(file + suffix)
		if err != nil {
			t.Fatal(err)
		}
	}
	output := filepath.Join(t.TempDir(), "recovered.sqlite")
	counts, err := RecoverDatabase(file, output)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := counts["request_events"]; !ok {
		t.Fatal("request diagnostics table lost")
	}
	if counts["kv"] == 0 || counts["prices"] == 0 || len(counts) != 11 {
		t.Fatalf("missing tables or rows: %v", counts)
	}
	for suffix, want := range before {
		got, err := os.ReadFile(file + suffix)
		if err != nil || !bytes.Equal(got, want) {
			t.Fatalf("source%s changed: %v", suffix, err)
		}
	}
	s, err := Open(output)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if s.get("pending-wal") != "retained" {
		t.Fatal("committed WAL data lost")
	}
	if results := s.mustQuery("PRAGMA integrity_check"); len(results) != 1 || results[0]["integrity_check"] != "ok" {
		t.Fatalf("invalid recovered database: %v", results)
	}
}

func TestRecoverDatabasePreservesValuesAndIndexes(t *testing.T) {
	file := filepath.Join(t.TempDir(), "monitor.sqlite")
	s, err := Open(file)
	if err != nil {
		t.Fatal(err)
	}
	if err = s.exec(`INSERT INTO accounts VALUES('test','中文账号','codex');
		INSERT INTO usage(id,session,ts,input,cached,output,account) VALUES('request','session','2026-10-07T00:00:00Z',1200,300,42,'test');`); err != nil {
		t.Fatal(err)
	}
	if err = s.set("settings", Object{"theme": "dark", "clearedAt": "2026-09-01T00:00:00Z"}); err != nil {
		t.Fatal(err)
	}
	want := map[string][]Object{}
	for _, row := range s.mustQuery("SELECT name FROM sqlite_master WHERE type='table'") {
		name := text(row["name"])
		want[name] = s.mustQuery("SELECT * FROM " + name + " NOT INDEXED ORDER BY rowid")
	}
	indexes := s.mustQuery("SELECT name,sql FROM sqlite_master WHERE type='index' ORDER BY name")
	if err = s.Close(); err != nil {
		t.Fatal(err)
	}
	output := filepath.Join(t.TempDir(), "recovered.sqlite")
	if _, err = RecoverDatabase(file, output); err != nil {
		t.Fatal(err)
	}
	r, err := Open(output)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	for name, rows := range want {
		if got := r.mustQuery("SELECT * FROM " + name + " NOT INDEXED ORDER BY rowid"); !reflect.DeepEqual(got, rows) {
			t.Errorf("%s data changed", name)
		}
	}
	if got := r.mustQuery("SELECT name,sql FROM sqlite_master WHERE type='index' ORDER BY name"); !reflect.DeepEqual(got, indexes) {
		t.Error("indexes changed")
	}
}

func TestRecoverDatabaseRejectsUnreadableTable(t *testing.T) {
	file := pendingWALFixture(t, false)
	main, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	pageSize := int(binary.BigEndian.Uint16(main[16:18]))
	if pageSize == 1 {
		pageSize = 65536
	}
	main[7*pageSize] = 0 // usage table root page 8
	if err = os.WriteFile(file, main, 0600); err != nil {
		t.Fatal(err)
	}
	output := filepath.Join(t.TempDir(), "recovered.sqlite")
	if _, err = RecoverDatabase(file, output); err == nil || !strings.Contains(err.Error(), "usage") {
		t.Fatalf("unreadable table must fail with details: %v", err)
	}
	if _, err = os.Stat(output); !os.IsNotExist(err) {
		t.Fatalf("failed recovery left an output: %v", err)
	}
}

func TestRecoverDatabaseDoesNotOverwriteDestination(t *testing.T) {
	file := pendingWALFixture(t, false)
	output := filepath.Join(t.TempDir(), "existing.sqlite")
	want := []byte("existing data")
	if err := os.WriteFile(output, want, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := RecoverDatabase(file, output); err == nil {
		t.Fatal("existing destination accepted")
	}
	got, err := os.ReadFile(output)
	if err != nil || !bytes.Equal(got, want) {
		t.Fatalf("existing destination changed: %v", err)
	}
}

func TestRepairProfileBacksUpOriginalAndRestartsService(t *testing.T) {
	file := pendingWALFixture(t, true)
	original := map[string][]byte{}
	for _, suffix := range []string{"", "-wal"} {
		var err error
		original[suffix], err = os.ReadFile(file + suffix)
		if err != nil {
			t.Fatal(err)
		}
	}
	data := filepath.Dir(file)
	backup, err := RepairProfile(data)
	if err != nil {
		t.Fatal(err)
	}
	for suffix, want := range original {
		got, err := os.ReadFile(filepath.Join(backup, "monitor.sqlite"+suffix))
		if err != nil || !bytes.Equal(got, want) {
			t.Fatalf("original%s missing from backup: %v", suffix, err)
		}
	}
	service, err := Start(Config{Data: data, Offline: true})
	if err != nil {
		t.Fatal(err)
	}
	service.Close()
	s, err := Open(file)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if s.get("pending-wal") != "retained" {
		t.Fatal("pending committed data lost")
	}
}

func TestRepairProfileRespectsProfileLock(t *testing.T) {
	file := pendingWALFixture(t, true)
	release, err := AcquireProfileLock(filepath.Dir(file))
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	if _, err = RepairProfile(filepath.Dir(file)); err == nil {
		t.Fatal("repair accepted an active profile")
	}
}

func TestRepairProfileRejectsUnreadableDataWithoutChangingSource(t *testing.T) {
	data := t.TempDir()
	file := filepath.Join(data, "monitor.sqlite")
	want := []byte("unreadable database")
	if err := os.WriteFile(file, want, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := RepairProfile(data); err == nil {
		t.Fatal("unreadable database accepted")
	}
	got, err := os.ReadFile(file)
	if err != nil || !bytes.Equal(got, want) {
		t.Fatalf("original source changed: %v", err)
	}
}
