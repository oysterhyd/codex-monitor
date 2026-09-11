const { spawn, execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { promisify } = require("node:util");
const activeChildren = new Set();
// Resolution can fall back to a PowerShell AppX query (measured ~1.5 s on a machine
// whose Codex came from the Store) and is re-run on every quota interval. Cache the
// answer, and only trust the cache while the caller's override is unchanged.
let resolvedCodex = null;
let resolvedOverride = null;

async function findCodex(override) {
  if (override) {
    if (
      !path.isAbsolute(override) ||
      !fs.existsSync(override) ||
      path.extname(override).toLowerCase() !== ".exe"
    )
      throw new Error("请选择有效的 codex.exe 绝对路径");
    return override;
  }
  if (resolvedCodex && resolvedOverride === null) return resolvedCodex;
  resolvedOverride = null;
  // Prefer the installed standalone binary: Store-package executables can reject external launches.
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    const file = path.join(
      dir,
      "node_modules",
      "@openai",
      "codex",
      "node_modules",
      "@openai",
      "codex-win32-x64",
      "vendor",
      "x86_64-pc-windows-msvc",
      "bin",
      "codex.exe",
    );
    if (fs.existsSync(file)) return (resolvedCodex = file);
  }
  try {
    const { stdout } = await promisify(execFile)(
      "pwsh",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Get-AppxPackage *OpenAI.Codex* | Select-Object -ExpandProperty InstallLocation",
      ],
      { windowsHide: true, timeout: 10000 },
    );
    for (const dir of stdout.trim().split(/\r?\n/).reverse()) {
      const file = path.join(dir.trim(), "app", "resources", "codex.exe");
      if (fs.existsSync(file)) return (resolvedCodex = file);
    }
  } catch {}
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    const file = path.join(
      dir,
      "node_modules",
      "@openai",
      "codex",
      "node_modules",
      "@openai",
      "codex-win32-x64",
      "vendor",
      "x86_64-pc-windows-msvc",
      "bin",
      "codex.exe",
    );
    if (fs.existsSync(file)) return (resolvedCodex = file);
  }
  throw new Error(
    "未找到 Codex App Server，请在设置中选择桌面端随附的 codex.exe",
  );
}

function describeQuotaError(error) {
  const message = String(error?.message || "");
  const status = message.match(/\b(401|403|429|500|502|503|504)\b/)?.[1];
  let reason = "额度服务暂时不可用";
  if (status === "401" || /unauthenticated|not logged in|authentication required/i.test(message)) reason = "登录状态已失效，请在 Codex 中重新登录";
  else if (status === "403") reason = "额度服务拒绝访问";
  else if (status === "429") reason = "额度查询受到限流，请稍后重试";
  else if (/timeout|timed out/i.test(message)) reason = "额度查询超时";
  else if (/connect|network|dns|request|fetch/i.test(message)) reason = "无法连接额度服务，请检查网络";
  return reason + (status ? `（HTTP ${status}）` : "") + "；保留最近快照";
}

async function readQuota({ codexHome, executable }) {
  const binary = await findCodex(executable);
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ["app-server"], {
      windowsHide: true,
      env: { ...process.env, CODEX_HOME: codexHome },
      stdio: ["pipe", "pipe", "pipe"],
    });
    activeChildren.add(child);
    let buffer = "",
      done = false;
    const finish = (error, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      activeChildren.delete(child);
      child.kill();
      error ? reject(error) : resolve(value);
    };
    const timer = setTimeout(
      () => finish(new Error("额度查询超时；保留上次快照，稍后重试")),
      25000,
    );
    const send = (value) => {
      if (!child.stdin.destroyed)
        child.stdin.write(JSON.stringify(value) + "\n");
    };
    child.on("error", () => finish(new Error("无法启动 Codex App Server")));
    child.stdin.on("error", () =>
      finish(new Error("Codex App Server 连接已关闭")),
    );
    child.on("exit", () =>
      finish(new Error("Codex App Server 提前退出，请检查登录状态")),
    );
    child.stderr.on("data", () => {}); // Never persist upstream diagnostics, which may contain sensitive data.
    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      let index;
      while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.id === 1) {
          if (msg.error) return finish(new Error("App Server 初始化失败"));
          send({ method: "initialized" });
          send({ id: 2, method: "account/rateLimits/read" });
        }
        if (msg.id === 2) {
          if (msg.error)
            return finish(
              new Error(describeQuotaError(msg.error)),
            );
          finish(null, {
            result: msg.result,
            timestamp: new Date().toISOString(),
          });
        }
      }
    });
    send({
      id: 1,
      method: "initialize",
      params: {
        clientInfo: {
          name: "codex_monitor",
          title: "Codex Monitor",
          version: "0.1.0",
        },
      },
    });
  });
}
module.exports = {
  describeQuotaError,
  readQuota,
  findCodex,
  stopQueries: () => {
    for (const child of activeChildren) child.kill();
  },
};
