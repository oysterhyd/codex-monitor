package monitor

import (
	"bytes"
	"database/sql"
	"encoding/binary"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// A pending committed WAL must be read during validation, but a failed open
// must not checkpoint it into the original database or truncate either file.
func pendingWALFixture(t *testing.T, corrupt bool) string {
	t.Helper()
	source := filepath.Join(t.TempDir(), "source.sqlite")
	s, err := Open(source)
	if err != nil {
		t.Fatal(err)
	}
	root := int(num(s.mustOne("SELECT rootpage FROM sqlite_master WHERE name='sqlite_autoindex_usage_1'")["rootpage"]))
	if err = s.Close(); err != nil {
		t.Fatal(err)
	}
	db, err := sql.Open("sqlite", source)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`PRAGMA wal_autocheckpoint=0; INSERT INTO kv VALUES('pending-wal','"retained"');`); err != nil {
		t.Fatal(err)
	}
	main, err := os.ReadFile(source)
	if err != nil {
		t.Fatal(err)
	}
	wal, err := os.ReadFile(source + "-wal")
	if err != nil {
		t.Fatal(err)
	}
	if err = db.Close(); err != nil {
		t.Fatal(err)
	}
	if len(wal) <= 32 {
		t.Fatal("no pending WAL frames")
	}
	if corrupt {
		pageSize := int(binary.BigEndian.Uint16(main[16:18]))
		if pageSize == 1 {
			pageSize = 65536
		}
		main[(root-1)*pageSize] = 0 // invalid b-tree page type in an index
	}
	dir := filepath.Join(t.TempDir(), "profile # 中文")
	if err = os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(dir, "monitor.sqlite")
	if err = os.WriteFile(file, main, 0600); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(file+"-wal", wal, 0600); err != nil {
		t.Fatal(err)
	}
	return file
}

func TestFailedOpenDoesNotCheckpointPendingWAL(t *testing.T) {
	file := pendingWALFixture(t, true)
	before := map[string][]byte{}
	for _, suffix := range []string{"", "-wal"} {
		b, err := os.ReadFile(file + suffix)
		if err != nil {
			t.Fatal(err)
		}
		before[suffix] = b
	}
	if s, err := Open(file); err == nil {
		s.Close()
		t.Fatal("corruption admitted")
	}
	for suffix, want := range before {
		got, err := os.ReadFile(file + suffix)
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(got, want) {
			t.Fatalf("failed validation changed database%s", suffix)
		}
	}
}

func TestReadonlyValidationIncludesPendingWAL(t *testing.T) {
	file := pendingWALFixture(t, false)
	s, err := Open(file)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if s.get("pending-wal") != "retained" {
		t.Fatal("committed WAL ignored")
	}
}

func TestValidationReportsCorruptionDetails(t *testing.T) {
	err := checkExistingDatabase(pendingWALFixture(t, true))
	if err == nil || !strings.Contains(err.Error(), "：") {
		t.Fatalf("missing corruption details: %v", err)
	}
}
