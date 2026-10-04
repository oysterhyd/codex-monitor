const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const UNKNOWN = 'unassigned';
// Tables whose rows carry an account column, with their time column — shared by
// post-scan backfill (store.cjs) and range reassignment (assignUnknown below).
const accountTables = [['usage','ts'],['turns','started'],['quotas','ts']];
function readAccount(home) {
  try {
    const auth = JSON.parse(fs.readFileSync(path.join(home, 'auth.json'), 'utf8'));
    const raw = auth.tokens?.account_id;
    if (typeof raw !== 'string' || !raw.trim()) return null;
    let email = '', user = '';
    try {
      const claims = JSON.parse(Buffer.from(auth.tokens.id_token.split('.')[1], 'base64url').toString());
      email = claims.email || '';
      user = claims['https://api.openai.com/auth']?.chatgpt_user_id || claims.sub || email;
    } catch {}
    const id = crypto.createHash('sha256').update('chatgpt:' + raw + ':' + user).digest('hex');
    return { id, label: typeof email === 'string' && email.length < 200 ? email : `Account ${id.slice(0, 8)}` };
  } catch { return null; }
}
// Pi's Codex OAuth credential is read for identity only; never refresh or persist it.
function readPiAccount(home, provider = 'openai-codex') {
  try {
    if (provider === 'openai' && !readPiOpenAIAuth(home)) return null;
    const credential = JSON.parse(fs.readFileSync(path.join(home, 'auth.json'), 'utf8'))[provider];
    if (credential?.type !== 'oauth' || typeof credential.access !== 'string') return null;
    const claims = JSON.parse(Buffer.from(credential.access.split('.')[1], 'base64url').toString());
    const auth = claims['https://api.openai.com/auth'];
    const raw = auth?.chatgpt_account_id;
    const user = auth?.chatgpt_user_id || claims.sub;
    if (typeof raw !== 'string' || !raw || typeof user !== 'string' || !user) return null;
    const id = crypto.createHash('sha256').update('chatgpt:' + raw + ':' + user).digest('hex');
    const email = claims.email || claims['https://api.openai.com/profile']?.email;
    return { id, label: typeof email === 'string' && email.length < 200 ? email : `Account ${id.slice(0, 8)}` };
  } catch { return null; }
}
// New Pi OpenAI sign-in uses subscription direct-token OAuth, but writes the same
// provider/api names as API-key requests. Inspect only local auth/config metadata;
// never refresh credentials or retain the access token. A normal OpenAI key or an
// overridden/proxied provider is NOT evidence of ChatGPT subscription usage.
function readPiOpenAIAuth(home) {
  try {
    const c = JSON.parse(fs.readFileSync(path.join(home, 'auth.json'), 'utf8')).openai;
    if (c?.type !== 'oauth' || typeof c.access !== 'string') return false;
    const claims = JSON.parse(Buffer.from(c.access.split('.')[1], 'base64url').toString());
    const direct = 'chatgpt.tokens.use.direct';
    const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (claims.iss !== 'https://auth.openai.com' || !audience.includes('https://api.openai.com/v1') ||
        typeof claims.scope !== 'string' || !claims.scope.split(/\s+/).includes(direct) ||
        !Array.isArray(c.scopes) || !c.scopes.includes(direct)) return false;
    let override;
    try { override = JSON.parse(fs.readFileSync(path.join(home, 'models.json'), 'utf8')).providers?.openai; }
    catch (error) { if (error.code !== 'ENOENT') return false; }
    if (override) {
      if (override.apiKey || override.headers || (override.api && override.api !== 'openai-responses')) return false;
      if (override.baseUrl && override.baseUrl.replace(/\/$/, '') !== 'https://api.openai.com/v1') return false;
      if ((override.models || []).some(m => m.apiKey || m.headers || m.baseUrl || (m.api && m.api !== 'openai-responses'))) return false;
    }
    return true;
  } catch { return false; }
}
function migrateAccounts(store) {
  store.db.exec(`CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY,label TEXT NOT NULL,kind TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS account_observations(id INTEGER PRIMARY KEY,account TEXT NOT NULL,started TEXT NOT NULL,ended TEXT NOT NULL);`);
  if (!store.db.prepare('PRAGMA table_info(account_observations)').all().some(c => c.name === 'source'))
    store.db.exec("ALTER TABLE account_observations ADD COLUMN source TEXT NOT NULL DEFAULT 'codex'");
  for (const table of ['usage', 'turns', 'quotas']) {
    if (!store.db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === 'account'))
      store.db.exec(`ALTER TABLE ${table} ADD COLUMN account TEXT NOT NULL DEFAULT '${UNKNOWN}'`);
    store.db.exec(`CREATE INDEX IF NOT EXISTS ${table}_account_time ON ${table}(account,${table === "turns" ? "started" : "ts"})`);
  }
  store.db.exec("CREATE INDEX IF NOT EXISTS quota_account_window_time ON quotas(account,bucket,slot,ts DESC)");
}
function observeAccount(store, home, now = new Date().toISOString(), source = 'codex') {
  const account = source === 'pi' ? readPiAccount(home) : source === 'pi-openai' ? readPiAccount(home, 'openai') : readAccount(home);
  const id = account?.id || UNKNOWN;
  if (account) store.sql('INSERT INTO accounts VALUES(?,?,?) ON CONFLICT(id) DO NOTHING').run(id, account.label, 'detected');
  // Resume the persisted interval when the observed identity is unchanged.
  // A real identity change (including logout) still starts a separate interval.
  const previous = store.sql('SELECT * FROM account_observations WHERE source=? ORDER BY id DESC LIMIT 1').get(source);
  if (previous?.account === id && now >= previous.ended) {
    if (source === 'codex') store.observationId = previous.id;
    store.sql('UPDATE account_observations SET ended=? WHERE id=?').run(now, previous.id);
  } else {
    const observationId = Number(store.sql('INSERT INTO account_observations(account,started,ended,source) VALUES(?,?,?,?)').run(id, now, now, source).lastInsertRowid);
    if (source === 'codex') store.observationId = observationId;
  }
  if (source === 'codex') {
    store.observedAccount = id;
    store.lastAccountObservation = Date.parse(now);
  }
  // The cached interval list must not serve stale answers for a new interval.
  store.accountIntervals = null;
  if (source === 'codex') store.set('currentAccount', id);
  return id;
}
function accountAt(store, ts, source = 'codex') {
  // One query per record is an N+1 over the record path. The interval list is small
  // and loaded once per observation, then resolved in memory with the same IN
  // semantics; the SQL fallback keeps ad-hoc calls identical.
  let intervals = store.accountIntervals;
  if (intervals === undefined || intervals === null) {
    intervals = store.sql('SELECT account,started,ended,source FROM account_observations ORDER BY id DESC').all();
    store.accountIntervals = intervals;
  }
  for (const row of intervals) {
    if (row.source === source && row.started <= ts && row.ended >= ts) return row.account || UNKNOWN;
  }
  return UNKNOWN;
}
function saveAccount(store, input) {
  const label = typeof input?.label === 'string' ? input.label.trim() : '';
  if (!label || label.length > 100) throw new Error('账号名称须为 1–100 个字符');
  const id = input.id || crypto.randomUUID();
  if (input.id && !store.sql('SELECT id FROM accounts WHERE id=?').get(id)) throw new Error('账号不存在');
  store.sql('INSERT INTO accounts VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET label=excluded.label').run(id, label, 'manual');
  return { id, label };
}
function assignUnknown(store, input) {
  const { bounds } = require('./metrics.cjs');
  if (!store.sql('SELECT id FROM accounts WHERE id=?').get(input.account)) throw new Error('账号不存在');
  const { start, end } = bounds(input);
  store.db.exec('BEGIN');
  try {
    let count = 0;
    if (input.turn && input.session) {
      count += store.sql('UPDATE usage SET account=? WHERE turn=? AND session=?').run(input.account,input.turn,input.session).changes;
      count += store.sql('UPDATE turns SET account=? WHERE id=? AND session=?').run(input.account,input.turn,input.session).changes;
      store.db.exec('COMMIT'); return count;
    }
    for (const [table, time] of accountTables)
      count += store.sql(`UPDATE ${table} SET account=? WHERE account=? AND ${time}>=? AND ${time}<?`).run(input.account, UNKNOWN, start, end).changes;
    store.db.exec('COMMIT'); return count;
  } catch (error) { store.db.exec('ROLLBACK'); throw error; }
}
module.exports = { UNKNOWN, accountTables, readAccount, readPiAccount, readPiOpenAIAuth, migrateAccounts, observeAccount, accountAt, saveAccount, assignUnknown };
