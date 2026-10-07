package monitor

import (
	"math"
	"sort"
	"time"
)

func (s *Store) activity(f Object, prices []Object, now time.Time) Object {
	now = now.In(time.Local)
	year := int(num(f["activityYear"]))
	if year < 1970 || year > now.Year() || num(f["activityYear"]) != float64(year) {
		year = now.Year()
	}
	start := time.Date(year, 1, 1, 0, 0, 0, 0, time.Local)
	end := start.AddDate(1, 0, 0)
	where := ""
	values := []any{}
	for _, p := range [][2]string{{"account", "u.account"}, {"model", "u.model"}, {"session", "u.session"}, {"project", "s.project"}} {
		if truth(f[p[0]]) {
			where += " AND " + p[1] + "=?"
			values = append(values, f[p[0]])
		}
	}
	join := "FROM usage u LEFT JOIN sessions s ON s.id=u.session"
	first := s.mustOne("SELECT MIN(u.ts) first "+join+" WHERE 1=1"+where, values...)["first"]
	days := map[string]Object{}
	order := []Object{}
	members := map[string]map[string]bool{}
	sessions := map[string]bool{}
	hours := []Object{}
	for h := 0; h < 24; h++ {
		hours = append(hours, Object{"hour": h, "total": 0., "requests": 0.})
	}
	today := now.Format("2006-01-02")
	args := append([]any{iso(start), iso(end)}, values...)
	for _, u := range s.mustQuery("SELECT u.* "+join+" WHERE u.ts>=? AND u.ts<?"+where+" ORDER BY u.ts", args...) {
		t := parse(u["ts"]).In(time.Local)
		key := t.Format("2006-01-02")
		if key > today {
			continue
		}
		day := days[key]
		if day == nil {
			day = Object{"date": key, "total": 0., "output": 0., "requests": 0., "cost": 0., "unpriced": 0.}
			days[key] = day
			order = append(order, day)
			members[key] = map[string]bool{}
		}
		p := costOf(u, prices)
		tokens := num(u["input"]) + num(u["output"])
		day["total"] = num(day["total"]) + tokens
		day["output"] = num(day["output"]) + num(u["output"])
		day["requests"] = num(day["requests"]) + 1
		if p["cost"] == nil {
			day["unpriced"] = num(day["unpriced"]) + 1
		} else {
			day["cost"] = num(day["cost"]) + num(p["cost"])
		}
		members[key][text(u["session"])] = true
		sessions[text(u["session"])] = true
		h := hours[t.Hour()]
		h["total"] = num(h["total"]) + tokens
		h["requests"] = num(h["requests"]) + 1
	}
	active := map[int64]bool{}
	longest, streak := 0, 0
	previous := int64(math.MinInt64)
	total, requests := 0., 0.
	var peak any
	for _, day := range order {
		day["sessions"] = len(members[text(day["date"])])
		if day["unpriced"] == day["requests"] {
			day["cost"] = nil
		}
		total += num(day["total"])
		requests += num(day["requests"])
		if num(day["total"]) <= 0 {
			continue
		}
		d, _ := time.Parse("2006-01-02", text(day["date"]))
		index := d.Unix() / 86400
		active[index] = true
		if index == previous+1 {
			streak++
		} else {
			streak = 1
		}
		longest = max(longest, streak)
		previous = index
		if peak == nil || num(day["total"]) > num(obj(peak)["total"]) {
			peak = day
		}
	}
	current := 0
	if year == now.Year() {
		d, _ := time.Parse("2006-01-02", today)
		i := d.Unix() / 86400
		if !active[i] {
			i--
		}
		for active[i] {
			current++
			i--
		}
	}
	firstYear := now.Year()
	if truth(first) {
		firstYear = parse(first).In(time.Local).Year()
	}
	return Object{"year": year, "today": today, "firstYear": firstYear, "days": order, "hours": hours, "stats": Object{"activeDays": len(active), "longestStreak": longest, "currentStreak": current, "sessions": len(sessions), "total": total, "requests": requests, "peak": peak}}
}

func (s *Store) Widget(now time.Time) Object {
	account := s.get("currentAccount")
	if !truth(account) {
		account = Unknown
	}
	local := now.In(time.Local)
	today := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, time.Local)
	yesterday := today.AddDate(0, 0, -1)
	lo := yesterday
	if now.Add(-24 * time.Hour).Before(lo) {
		lo = now.Add(-24 * time.Hour)
	}
	timeline, speed := []Object{}, []Object{}
	for i := 0; i < 96; i++ {
		timeline = append(timeline, Object{"time": now.UnixMilli() - int64(95-i)*900000, "total": 0.})
	}
	for i := 0; i < 20; i++ {
		speed = append(speed, Object{"time": now.UnixMilli() - int64(19-i)*3000, "total": 0.})
	}
	total, previous, input, cached, output := 0., 0., 0., 0., 0.
	for _, r := range s.mustQuery("SELECT ts,input,cached,output FROM usage WHERE ts>=? AND ts<=? ORDER BY ts", iso(lo), iso(now)) {
		t := parse(r["ts"])
		tokens := num(r["input"]) + num(r["output"])
		if !t.Before(today) {
			total += tokens
			input += num(r["input"])
			cached += num(r["cached"])
		} else if !t.Before(yesterday) {
			previous += tokens
		}
		bin := int(math.Ceil(float64(t.UnixMilli()-(now.UnixMilli()-86400000))/900000)) - 1
		if bin >= 0 && bin < 96 {
			timeline[bin]["total"] = num(timeline[bin]["total"]) + tokens
		}
		bin = int(math.Ceil(float64(t.UnixMilli()-(now.UnixMilli()-60000))/3000)) - 1
		if bin >= 0 && bin < 20 {
			output += num(r["output"])
			speed[bin]["total"] = num(speed[bin]["total"]) + num(r["output"])/3
		}
	}
	quotas := s.mustQuery("SELECT q.* FROM (SELECT DISTINCT bucket,slot FROM quotas WHERE account=?) b JOIN quotas q ON q.rowid=(SELECT rowid FROM quotas WHERE account=? AND bucket=b.bucket AND slot=b.slot ORDER BY ts DESC,rowid DESC LIMIT 1)", account, account)
	buckets := []string{}
	seen := map[string]bool{}
	for _, q := range quotas {
		b := text(q["bucket"])
		if !seen[b] {
			buckets = append(buckets, b)
			seen[b] = true
		}
	}
	sort.SliceStable(buckets, func(i, j int) bool {
		if buckets[i] == "codex" {
			return true
		}
		if buckets[j] == "codex" {
			return false
		}
		return buckets[i] < buckets[j]
	})
	var bucket any
	for _, b := range buckets {
		for _, q := range quotas {
			if q["bucket"] == b && num(q["minutes"]) == 300 {
				bucket = b
				break
			}
		}
		if bucket != nil {
			break
		}
	}
	if bucket == nil && len(buckets) > 0 {
		bucket = buckets[0]
	}
	chosen := []Object{}
	for _, q := range quotas {
		if q["bucket"] == bucket {
			chosen = append(chosen, q)
		}
	}
	change, cacheRate := any(nil), any(nil)
	if previous > 0 {
		change = (total - previous) / previous
	}
	if input > 0 {
		cacheRate = cached / input
	}
	var status any
	if q := obj(s.get("quotaStatus")); q["account"] == account {
		status = q
	}
	r := Object{"account": account, "usageScope": "all", "total": total, "previous": previous, "change": change, "cacheRate": cacheRate, "tps": output / 60, "speed": speed, "timeline": timeline, "quotas": chosen, "scan": s.get("scan"), "quotaStatus": status, "language": s.settings()["language"]}
	if bucket != nil {
		r["bucket"] = bucket
	}
	return r
}
