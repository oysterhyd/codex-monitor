const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const UNKNOWN = 'unassigned';
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
function migrateAccounts(store) {
  store.db.exec(`CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY,label TEXT NOT NULL,kind TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS account_observations(id INTEGER PRIMARY KEY,account TEXT NOT NULL,started TEXT NOT NULL,ended TEXT NOT NULL);`);
  for (const table of ['usage', 'turns', 'quotas']) {
    if (!store.db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === 'account'))
      store.db.exec(`ALTER TABLE ${table} ADD COLUMN account TEXT NOT NULL DEFAULT 'unassigned'`);
    store.db.exec(`CREATE INDEX IF NOT EXISTS ${table}_account_time ON ${table}(account,${table === "turns" ? "started" : "ts"})`);
  }
  store.db.exec("CREATE INDEX IF NOT EXISTS quota_account_window_time ON quotas(account,bucket,slot,ts DESC)");
}
function observeAccount(store, home, now = new Date().toISOString()) {
  const account = readAccount(home);
  const id = account?.id || UNKNOWN;
  if (account) store.db.prepare('INSERT INTO accounts VALUES(?,?,?) ON CONFLICT(id) DO NOTHING').run(id, account.label, 'detected');
  // Resume the persisted interval when the observed identity is unchanged.
  // A real identity change (including logout) still starts a separate interval.
  const previous = store.db.prepare('SELECT * FROM account_observations ORDER BY id DESC LIMIT 1').get();
  if (previous?.account === id && now >= previous.ended) {
    store.observationId = previous.id;
    store.db.prepare('UPDATE account_observations SET ended=? WHERE id=?').run(now, previous.id);
  } else {
    store.observationId = Number(store.db.prepare('INSERT INTO account_observations(account,started,ended) VALUES(?,?,?)').run(id, now, now).lastInsertRowid);
  }
  store.observedAccount = id;
  store.lastAccountObservation = Date.parse(now);
  store.set('currentAccount', id);
  return id;
}
function accountAt(store, ts) {
  return store.db.prepare('SELECT account FROM account_observations WHERE started<=? AND ended>=? ORDER BY id DESC LIMIT 1').get(ts, ts)?.account || UNKNOWN;
}
function saveAccount(store, input) {
  const label = typeof input?.label === 'string' ? input.label.trim() : '';
  if (!label || label.length > 100) throw new Error('账号名称须为 1–100 个字符');
  const id = input.id || crypto.randomUUID();
  if (input.id && !store.db.prepare('SELECT id FROM accounts WHERE id=?').get(id)) throw new Error('账号不存在');
  store.db.prepare('INSERT INTO accounts VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET label=excluded.label').run(id, label, 'manual');
  return { id, label };
}
function assignUnknown(store, input) {
  const { bounds } = require('./metrics.cjs');
  if (!store.db.prepare('SELECT id FROM accounts WHERE id=?').get(input.account)) throw new Error('账号不存在');
  const { start, end } = bounds(input);
  store.db.exec('BEGIN');
  try {
    let count = 0;
    if (input.turn && input.session) {
      count += store.db.prepare('UPDATE usage SET account=? WHERE turn=? AND session=?').run(input.account,input.turn,input.session).changes;
      count += store.db.prepare('UPDATE turns SET account=? WHERE id=? AND session=?').run(input.account,input.turn,input.session).changes;
      store.db.exec('COMMIT'); return count;
    }
    for (const [table, time] of [['usage','ts'],['turns','started'],['quotas','ts']])
      count += store.db.prepare(`UPDATE ${table} SET account=? WHERE account=? AND ${time}>=? AND ${time}<?`).run(input.account, UNKNOWN, start, end).changes;
    store.db.exec('COMMIT'); return count;
  } catch (error) { store.db.exec('ROLLBACK'); throw error; }
}
module.exports = { UNKNOWN, readAccount, migrateAccounts, observeAccount, accountAt, saveAccount, assignUnknown };
