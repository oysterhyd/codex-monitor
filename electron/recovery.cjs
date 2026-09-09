const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { Store } = require('./store.cjs');

function openStore(file) {
  if (!fs.existsSync(file)) return new Store(file);
  let source;
  try {
    source = new DatabaseSync(file, { readOnly: true });
    const check = source.prepare('PRAGMA quick_check').all();
    if (check.length === 1 && Object.values(check[0])[0] === 'ok') {
      source.close();
      return new Store(file);
    }
  } catch (error) {
    if (!/malformed|not a database|corrupt/i.test(error.message)) {
      source?.close(); throw error;
    }
  }
  const backup = path.join(path.dirname(file), 'recovery-backups', new Date().toISOString().replace(/[:.]/g,'-'));
  fs.mkdirSync(backup,{recursive:true});
  for (const suffix of ['', '-wal', '-shm']) {
    if (fs.existsSync(file+suffix)) fs.copyFileSync(file+suffix,path.join(backup,path.basename(file)+suffix));
  }
  if (!source) throw new Error('监测数据库损坏，原文件已备份；无法读取设置，请从备份恢复。');
  const recovered = {}, skipped = {};
  // Settings and manual prices are not reconstructible from Codex logs. Never silently drop them.
  try {
    recovered.kv = source.prepare('SELECT * FROM kv').all();
    recovered.prices = source.prepare('SELECT * FROM prices').all();
    if (source.prepare("SELECT 1 FROM sqlite_master WHERE name='accounts'").get()) recovered.accounts = source.prepare('SELECT * FROM accounts').all();
    for (const row of recovered.kv) JSON.parse(row.value);
  } catch (error) {
    source.close();
    throw new Error('数据库已备份，但设置或价格无法完整读取，已停止自动恢复。');
  }
  for (const table of ['account_observations','sessions','usage','turns','quotas','notices']) {
    if (!source.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) continue;
    try { recovered[table]=source.prepare(`SELECT * FROM ${table}`).all(); }
    catch {
      recovered[table]=[]; skipped[table]=0;
      // A broken leaf page must not prevent recovery of the remaining intact pages.
      let max=0;try{max=source.prepare(`SELECT MAX(rowid) n FROM ${table}`).get().n||0;}catch{}
      if (max>1000000) { skipped[table]=max; continue; }
      const one=source.prepare(`SELECT * FROM ${table} WHERE rowid=?`);
      for(let id=1;id<=max;id++) {
        try { const row=one.get(id);if(row)recovered[table].push(row); } catch { skipped[table]++; }
      }
    }
  }
  source.close();
  const staging=path.join(backup,'rebuilt.sqlite');
  const fresh=new Store(staging);
  try {
    fresh.db.exec('BEGIN');
    for (const [table, rows] of Object.entries(recovered)) {
      fresh.db.exec(`DELETE FROM ${table}`);
      const columns=fresh.db.prepare(`PRAGMA table_info(${table})`).all().map(c=>c.name);
      for (const row of rows) {
        // Reject misplaced data from corrupt pages. Log replay replaces all readable source records below.
        if(table==='quotas' && (typeof row.id!=='string'||typeof row.bucket!=='string'||!['primary','secondary'].includes(row.slot)||typeof row.used!=='number'||row.used<0||row.used>100||!Number.isFinite(Date.parse(row.ts))||(row.plan!==null&&typeof row.plan!=='string')||(typeof row.source!=='string'))) {skipped[table]=(skipped[table]||0)+1;continue;}
        if (table === 'usage' && (typeof row.id !== 'string' || typeof row.session !== 'string' || typeof row.model !== 'string' || !Number.isFinite(Date.parse(row.ts)) || ['input','cached','output','reasoning','cache_write'].some(k => row[k] !== null && (typeof row[k] !== 'number' || !Number.isFinite(row[k]) || row[k] < 0)))) { skipped[table]=(skipped[table]||0)+1;continue; }
        const keys=columns.filter(k=>Object.hasOwn(row,k));
        try { fresh.db.prepare(`INSERT ${table==='kv'||table==='prices'||table==='accounts'?'':'OR IGNORE'} INTO ${table}(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).run(...keys.map(k=>row[k])); }
        catch { if(table==='kv'||table==='prices'||table==='accounts')throw new Error('设置或价格恢复失败');skipped[table]=(skipped[table]||0)+1; }
      }
    }
    fresh.set('recovery',{at:new Date().toISOString(),backup,skipped,message:'监测数据库已重建，本机记录会自动同步；部分损坏的历史额度采样可能缺失。设置与价格已保留，原库位于数据目录 recovery-backups。'});
    fresh.set('replayRecovered',true);
    fresh.db.exec('COMMIT');
    const check=fresh.db.prepare('PRAGMA integrity_check').all();
    if(check.length!==1||Object.values(check[0])[0]!=='ok')throw new Error('重建数据库校验失败');
    fresh.close();
  } catch(error) {try{fresh.db.exec('ROLLBACK');fresh.close();}catch{}throw error;}
  // Keep the original files intact; the complete replacement is checked before activation.
  for(const suffix of ['','-wal','-shm'])if(fs.existsSync(file+suffix))fs.renameSync(file+suffix,path.join(backup,'original'+suffix+'.sqlite'));
  fs.copyFileSync(staging,file);
  return new Store(file);
}
module.exports={openStore};
