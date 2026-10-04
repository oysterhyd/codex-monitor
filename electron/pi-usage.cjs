const crypto = require('node:crypto');
const { accountAt } = require('./accounts.cjs');
const PI_ORIGIN = 'pi · 官方 Codex';
const PI_KIND = 'pi 官方 Codex';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const count = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const iso = value => {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
};

function processPi(store, entry, state) {
  const ts = iso(entry.timestamp);
  if (!ts) return;
  if (entry.type === 'session') {
    if (typeof entry.id !== 'string' || !entry.id) return;
    // Separate namespace from native Codex thread ids; state contains metadata only.
    state.session = 'pi:' + entry.id;
    state.project = typeof entry.cwd === 'string' && entry.cwd ? entry.cwd : '未归属项目';
    state.created = ts;
    return;
  }
  if (!state.session) return;
  const message = entry.type === 'message' ? entry.message : entry.type === 'usage' ? entry : null;
  if (!message || (entry.type === 'message' && message.role !== 'assistant')) return;
  // The built-in OAuth Codex provider is distinct from openai (API-key billing).
  // Do not infer from a GPT model name or the last model_change in a mixed session.
  if (message.provider !== 'openai-codex' ||
      (entry.type === 'message' && message.api !== 'openai-codex-responses') ||
      message.stopReason === 'pending') return;
  const cleared = (store.scanSettings || store.settings()).clearedAt;
  if (cleared && ts <= cleared) return;
  if (typeof message.model !== 'string' || !message.model) return;
  const u = message.usage;
  if (!u) return;
  const input = count(u.input), output = count(u.output);
  const cached = count(u.cacheRead ?? 0), write = count(u.cacheWrite ?? 0);
  const reasoning = count(u.reasoning ?? 0);
  if ([input, output, cached, write, reasoning].some(n => n === null) || reasoning > output) return;
  // Pi input excludes cache reads/writes. Store input includes both. Reasoning is
  // already a subset of output, and totalTokens/cost are not authoritative here.
  const totalInput = input + cached + write;
  if (!Number.isFinite(totalInput) || totalInput + output <= 0) return;
  const response = typeof message.responseId === 'string' && message.responseId;
  if (!response && (typeof entry.id !== 'string' || !entry.id)) return;
  // Fork/clone copies keep entry ids and timestamps, even though session ids change.
  // Global response ids (or this copy-stable fallback) dedup across files and restarts.
  const id = 'pi:' + hash(response ? 'response:' + response : JSON.stringify([entry.id, ts, message.provider, message.model]));
  const existing = store.sql('SELECT session FROM usage WHERE id=?').get(id);
  if (existing && !store.replayingRecovered) return;
  store.sql('INSERT OR IGNORE INTO sessions VALUES(?,?,?,?)')
    .run(state.session, state.project, PI_ORIGIN, state.created);
  const account = store.sql('SELECT account FROM usage WHERE id=?').get(id)?.account || accountAt(store, ts, 'pi');
  // Pi does not persist reliable start/TTFT/duration values. Represent each observed
  // response without inventing timings or including it in the running-task count.
  const status = message.stopReason === 'error' ? 'failed' : message.stopReason === 'aborted' ? 'aborted' : 'completed';
  store.sql('INSERT OR IGNORE INTO turns(id,session,model,started,ended,status,duration,ttft,last_seen,account) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(id, existing?.session || state.session, message.model, ts, ts, status, null, null, ts, account);
  store.addUsage(id, {
    input_tokens: totalInput, cached_input_tokens: cached, output_tokens: output,
    reasoning_output_tokens: reasoning, cache_write_input_tokens: write,
  }, ts, { session: existing?.session || state.session, turn: id, model: message.model, account }, PI_KIND);
}

// Separate from Codex's corpus-measured 180-byte dispatch filter: Pi writes usage
// AFTER arbitrarily long assistant content. Never search for provider/usage only
// in that head. Parse candidate entries, then persist the statistical whitelist.
const interestingPi = head => /^\s*\{\s*"type"\s*:\s*"(?:session|message|usage)"/.test(head);
module.exports = { processPi, interestingPi, PI_ORIGIN, PI_KIND };
