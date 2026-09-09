const { readAccount, saveAccount, assignUnknown, UNKNOWN } = require("./accounts.cjs");
const { parentPort, workerData } = require("node:worker_threads");
const { openStore } = require("./recovery.cjs");
const { summarize, csv, exportRows } = require("./metrics.cjs");
const { widgetSnapshot } = require("./widget-data.cjs");
const store = openStore(workerData.db);
let scanning = false,
  shutting = false;
const emit = (type, data) => parentPort.postMessage({ type, data });
let quotaReply;
function readQuota(options) {
  return new Promise((resolve, reject) => {
    quotaReply = { resolve, reject };
    emit("readQuota", options);
  });
}
async function scan(full = false) {
  if (scanning || shutting) return;
  scanning = true;
  try {
    const status = await store.scan(workerData.home, (p) => emit("progress", p), {full});
    if(status.changed || status.errors || status.full) emit("updated", null);
    if(status.errors) emit('diagnostic',{code:'scan_records',count:status.errors,items:status.diagnostics});
  } catch {
    emit('diagnostic',{code:'scan_failed'});
    emit("error", "读取本机统计记录失败，将自动重试");
  } finally {
    scanning = false;
  }
}
let quotaTask;
function quota() {
  if (shutting) return Promise.resolve();
  if (!quotaTask) quotaTask = queryQuota().finally(() => { quotaTask = null; });
  return quotaTask;
}
async function queryQuota() {
  const before = readAccount(workerData.home)?.id || UNKNOWN;
  try {
    const q = await readQuota({
      codexHome: workerData.home,
      executable: store.settings().codexExecutable,
    });
    while (scanning) await new Promise((r) => setTimeout(r, 30));
    if(shutting)return;
    const after = readAccount(workerData.home)?.id || UNKNOWN;
    if (before !== after) { emit("updated", null); return; }
    const groups = q.result.rateLimitsByLimitId || {
      codex: q.result.rateLimits,
    };
    for (const r of Object.values(groups))
      store.addQuota(r, q.timestamp, "在线查询", before);
    store.set("quotaStatus", { ok: true, attempted: q.timestamp, account: before });
    emit("quota", {
      account: before,
      groups: Object.values(groups),
      muted: store.settings().muted,
    });
    emit("updated", null);
  } catch (e) {
    while (scanning) await new Promise((r) => setTimeout(r, 30));
    if(shutting)return;
    store.set("quotaStatus", {
      account: before,
      ok: false,
      attempted: new Date().toISOString(),
      reason: e.message,
    });
    emit("updated", null);
  }
}
// Serialize writes with scans: a scan transaction must not swallow settings or a clear operation.
let queue = Promise.resolve();
parentPort.on("message", (msg) => {
  if (msg.quotaReply) {
    const reply = quotaReply;
    quotaReply = null;
    if (reply) {
      msg.error
        ? reply.reject(new Error(msg.error))
        : reply.resolve(msg.result);
    }
    return;
  }
  queue = queue.then(async () => {
    while (scanning) await new Promise((r) => setTimeout(r, 30));
    try {
      let result;
      switch (msg.method) {
        case "shutdown":
          shutting=true;
          clearInterval(scanTimer);clearInterval(quotaTimer);
          store.close();
          parentPort.postMessage({id:msg.id,result:true});
          parentPort.close();
          return;
        case "snapshot":
          result = summarize(store, msg.args);
          break;
        case "widget":
          result = widgetSnapshot(store);
          break;
        case "account":
          result = saveAccount(store, msg.args);
          break;
        case "assignAccount":
          result = assignUnknown(store, msg.args);
          break;
        case "settings":
          result = store.saveSettings(msg.args);
          break;
        case "price":
          result = store.savePrice(msg.args);
          break;
        case "export":
          result = csv(exportRows(store, msg.args));
          break;
        case "clear":
          store.clear();
          result = true;
          break;
        case "refresh":
          await scan(true);
          await quota();
          result = true;
          break;
        case "notice":
          result =
            store.db
              .prepare("INSERT OR IGNORE INTO notices VALUES(?,?)")
              .run(msg.args, new Date().toISOString()).changes > 0;
          break;
        default:
          throw new Error("未知操作");
      }
      parentPort.postMessage({ id: msg.id, result });
    } catch (e) {
      parentPort.postMessage({ id: msg.id, error: e.message });
    }
  });
});
queue = queue.then(scan);
quota();
let scanQueued = false;
const scanTimer=setInterval(() => {
  if(scanQueued || shutting) return;
  scanQueued=true;
  queue = queue.then(()=>scan()).finally(()=>{scanQueued=false;});
}, 3000);
const quotaTimer=setInterval(() => {
  const t = store.get("quotaStatus")?.attempted;
  if (!t || Date.now() - Date.parse(t) >= store.settings().quotaInterval * 1000)
    quota();
}, 5000);
