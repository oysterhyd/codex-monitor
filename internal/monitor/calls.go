package monitor

import (
	"math"
	"sort"
	"strings"
)

func (s *Store) callRows(f Object, lo, hi string, pricing priceIndex) []Object {
	priceDetails := map[string]Object{}
	for _, versions := range pricing {
		for _, p := range versions {
			priceDetails[text(p["id"])] = p
		}
	}
	conditions := []string{"u.ts>=?", "u.ts<?"}
	args := []any{lo, hi}
	for _, pair := range [][2]string{{"account", "u.account"}, {"model", "u.model"}, {"session", "u.session"}, {"turn", "u.turn"}, {"project", "s.project"}} {
		if truth(f[pair[0]]) {
			conditions = append(conditions, pair[1]+"=?")
			args = append(args, f[pair[0]])
		}
	}
	rows := s.mustQuery(`SELECT u.*,s.project,e.ttft,e.association,e.source timing_source,e.response_id
        FROM usage u LEFT JOIN sessions s ON s.id=u.session LEFT JOIN request_events e ON e.usage_id=u.id
        WHERE `+strings.Join(conditions, " AND ")+" ORDER BY u.ts,u.id", args...)
	sequence := map[string]int{}
	for _, r := range rows {
		r["usage_id"], r["id"], r["status"] = r["id"], "usage:"+text(r["id"]), "usage"
		r["total"] = num(r["input"]) + num(r["output"])
		r["cacheRate"] = nil
		if num(r["input"]) > 0 {
			r["cacheRate"] = num(r["cached"]) / num(r["input"])
		}
		for k, v := range pricing.cost(r) {
			r[k] = v
		}
		if p := priceDetails[text(r["priceId"])]; p != nil {
			r["priceInput"], r["priceCached"], r["priceOutput"] = p["input"], p["cached"], p["output"]
		}
		key := text(r["session"]) + ":" + text(r["turn"])
		sequence[key]++
		r["sequence"] = sequence[key]
		r["timingNote"] = requestTimingNote(text(r["association"]))
		if text(r["project"]) == "" {
			r["project"] = UnassignedProject
		}
	}
	conditions = []string{"e.ts>=?", "e.ts<?", "e.kind IN ('failed','retry')"}
	args = []any{lo, hi}
	for _, pair := range [][2]string{{"account", "e.account"}, {"model", "e.model"}, {"session", "e.session"}, {"turn", "e.turn"}, {"project", "s.project"}} {
		if truth(f[pair[0]]) {
			conditions = append(conditions, pair[1]+"=?")
			args = append(args, f[pair[0]])
		}
	}
	for _, r := range s.mustQuery("SELECT e.*,s.project FROM request_events e LEFT JOIN sessions s ON s.id=e.session WHERE "+strings.Join(conditions, " AND ")+" ORDER BY e.ts,e.id", args...) {
		r["status"], r["cost"], r["total"], r["cacheRate"] = r["kind"], nil, nil, nil
		r["errorLabel"] = requestErrorLabel(text(r["error_code"]))
		if text(r["project"]) == "" {
			r["project"] = UnassignedProject
		}
		rows = append(rows, r)
	}
	sort.SliceStable(rows, func(i, j int) bool {
		if rows[i]["ts"] == rows[j]["ts"] {
			return text(rows[i]["id"]) < text(rows[j]["id"])
		}
		return text(rows[i]["ts"]) < text(rows[j]["ts"])
	})
	return rows
}

func filterCalls(rows []Object, f Object) []Object {
	result := []Object{}
	query := strings.ToLower(strings.TrimSpace(text(f["callSearch"])))
	for _, r := range rows {
		if truth(f["callStatus"]) && r["status"] != f["callStatus"] {
			continue
		}
		if query != "" {
			match := false
			for _, key := range []string{"id", "usage_id", "response_id", "session", "turn", "model", "project"} {
				if strings.Contains(strings.ToLower(text(r[key])), query) {
					match = true
					break
				}
			}
			if !match {
				continue
			}
		}
		result = append(result, r)
	}
	sort.SliceStable(result, func(i, j int) bool {
		left, right := result[i], result[j]
		key := map[string]string{"tokens": "total", "cost": "cost", "ttft": "ttft"}[text(f["callOrder"])]
		if key != "" {
			if (left[key] == nil) != (right[key] == nil) {
				return left[key] != nil
			}
			if num(left[key]) != num(right[key]) {
				return num(left[key]) > num(right[key])
			}
		}
		if left["ts"] == right["ts"] {
			if f["callOrder"] == "oldest" {
				return text(left["id"]) < text(right["id"])
			}
			return text(left["id"]) > text(right["id"])
		}
		if f["callOrder"] == "oldest" {
			return text(left["ts"]) < text(right["ts"])
		}
		return text(left["ts"]) > text(right["ts"])
	})
	return result
}

func paginateCalls(rows []Object, page, size int) ([]Object, Object) {
	size = max(1, min(200, size))
	pages := max(1, (len(rows)+size-1)/size)
	page = max(1, min(pages, page))
	start := min(len(rows), (page-1)*size)
	return rows[start:min(len(rows), start+size)], Object{"page": page, "pageSize": size, "total": len(rows), "pages": pages}
}

func summarizeCalls(rows []Object) Object {
	summary := Object{"usageRecords": 0, "failedEvents": 0, "retryEvents": 0, "ttftSamples": 0, "avgTtft": nil, "p50Ttft": nil, "p95Ttft": nil, "total": 0., "cost": nil, "unpriced": 0, "cacheRate": nil, "largestId": nil}
	timings := []float64{}
	input, cached, cost, priced, largest := 0., 0., 0., 0, 0.
	for _, r := range rows {
		switch r["status"] {
		case "failed":
			summary["failedEvents"] = num(summary["failedEvents"]) + 1
		case "retry":
			summary["retryEvents"] = num(summary["retryEvents"]) + 1
		case "usage":
			summary["usageRecords"] = num(summary["usageRecords"]) + 1
			summary["total"] = num(summary["total"]) + num(r["total"])
			input += num(r["input"])
			cached += num(r["cached"])
			if r["cost"] == nil {
				summary["unpriced"] = num(summary["unpriced"]) + 1
			} else {
				cost += num(r["cost"])
				priced++
			}
			if r["ttft"] != nil {
				timings = append(timings, num(r["ttft"]))
			}
			if num(r["total"]) > largest {
				largest = num(r["total"])
				summary["largestId"] = r["id"]
			}
		}
	}
	if priced > 0 {
		summary["cost"] = cost
	}
	if input > 0 {
		summary["cacheRate"] = cached / input
	}
	if len(timings) > 0 {
		sort.Float64s(timings)
		sum := 0.
		for _, v := range timings {
			sum += v
		}
		summary["ttftSamples"], summary["avgTtft"] = len(timings), sum/float64(len(timings))
		summary["p50Ttft"] = timings[int(math.Ceil(.5*float64(len(timings))))-1]
		summary["p95Ttft"] = timings[int(math.Ceil(.95*float64(len(timings))))-1]
	}
	for _, r := range rows {
		r["tokenShare"], r["costShare"] = nil, nil
		if r["status"] == "usage" && num(summary["total"]) > 0 {
			r["tokenShare"] = num(r["total"]) / num(summary["total"])
		}
		if r["status"] == "usage" && r["cost"] != nil && cost > 0 {
			r["costShare"] = num(r["cost"]) / cost
		}
	}
	return summary
}

func (s *Store) callSnapshot(f Object, lo, hi string, pricing priceIndex) Object {
	rows := filterCalls(s.callRows(f, lo, hi, pricing), f)
	summary := summarizeCalls(rows)
	selected, pagination := paginateCalls(rows, int(num(f["callPage"])), 50)
	return Object{"rows": selected, "pagination": pagination, "summary": summary}
}

func (s *Store) taskCallSnapshot(f Object, pricing priceIndex) Object {
	if !truth(f["detailSession"]) || !truth(f["detailTurn"]) {
		return Object{}
	}
	filter := Object{"session": f["detailSession"], "turn": f["detailTurn"], "account": f["account"]}
	rows := s.callRows(filter, "0000", "9999", pricing)
	summary := summarizeCalls(rows)
	selected, pagination := paginateCalls(rows, int(num(f["detailPage"])), 25)
	return Object{"session": f["detailSession"], "turn": f["detailTurn"], "rows": selected, "pagination": pagination, "summary": summary}
}

func csvRows(cols []string, rows []Object) string {
	lines := []string{strings.Join(cols, ",")}
	for _, r := range rows {
		cells := []string{}
		for _, key := range cols {
			v := text(r[key])
			if v != "" && strings.ContainsRune("=+@-\t\r", rune(v[0])) {
				v = "'" + v
			}
			cells = append(cells, "\""+strings.ReplaceAll(v, "\"", "\"\"")+"\"")
		}
		lines = append(lines, strings.Join(cells, ","))
	}
	return "\uFEFF" + strings.Join(lines, "\r\n")
}

func (s *Store) exportCalls(f Object, lo, hi string) string {
	rows := filterCalls(s.callRows(f, lo, hi, indexPrices(s.prices())), f)
	cols := []string{"ts", "id", "usage_id", "response_id", "session", "turn", "model", "status", "input", "cached", "output", "reasoning", "cache_write", "cost", "inputCost", "outputCost", "priceId", "ttft", "association", "attempt", "http_status", "error_code", "kind"}
	return csvRows(cols, rows)
}

func callCoverage(s *Store) Object {
	return s.mustOne(`SELECT COUNT(*) received,COALESCE(SUM(usage_id IS NOT NULL),0) associated FROM request_events WHERE kind='completed'`)
}
