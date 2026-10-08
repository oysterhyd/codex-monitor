// Load with: pi -e /absolute/path/to/codex-monitor.ts
// Uses Pi's provider/stream hooks. No prompts, tool arguments or raw errors leave Pi.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { randomUUID } from "node:crypto";

const DEFAULT_ENDPOINT = "http://127.0.0.1:4319/v1/logs";

function errorCategory(message: string): string {
  if (/rate.?limit|too many requests/i.test(message)) return "rate_limit";
  if (/timeout|timed out/i.test(message)) return "timeout";
  if (/connection|disconnected|websocket|tls/i.test(message)) return "connection";
  if (/unauthorized|authentication/i.test(message)) return "authentication";
  return "request_error";
}

export default function codexMonitor(pi: ExtensionAPI) {
  let started: number | undefined;
  let firstToken: number | undefined;
  let attempt = 0;
  let httpFailed = false;
  let requestKey = randomUUID();
  let awaitingHeaders = false;
  let pending: Promise<unknown>[] = [];

  function send(ctx: any, name: string, fields: Record<string, string | number | boolean>) {
    const provider = fields["codex.monitor.provider"] || ctx.model?.provider;
    if (provider !== "openai-codex" && provider !== "openai") return false;
    const session = ctx.sessionManager.getSessionId();
    if (!session) return false;
    const endpoint = process.env.CODEX_MONITOR_OTEL_URL || DEFAULT_ENDPOINT;
    let url: URL;
    try { url = new URL(endpoint); } catch { return false; }
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1") return false;
    const timestamp = new Date();
    const attributes = Object.entries({
      "event.name": name,
      "event.timestamp": timestamp.toISOString(),
      "conversation.id": `pi:${session}`,
      "model": ctx.model?.id || "unknown",
      "codex.monitor.provider": ctx.model?.provider || "unknown",
      "codex.monitor.request_id": requestKey,
      ...fields,
    }).map(([key, value]) => ({ key, value: { stringValue: String(value) } }));
    const body = { resourceLogs: [{ scopeLogs: [{ logRecords: [{
      timeUnixNano: String(BigInt(timestamp.getTime()) * 1_000_000n), attributes,
    }] }] }] };
    // Collection failure never changes the model request or user-visible result.
    const request = fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body), signal: AbortSignal.timeout(1500),
    }).catch(() => undefined);
    pending.push(request);
    void request.finally(() => { pending = pending.filter(item => item !== request); });
    return true;
  }

  pi.on("turn_start", () => {
    started = undefined; firstToken = undefined; attempt = 0; httpFailed = false;
    requestKey = randomUUID();
    awaitingHeaders = false;
  });
  pi.on("before_provider_request", (_event, ctx) => {
    attempt++;
    if (attempt > 1) send(ctx, "codex.monitor.retry", { attempt: attempt - 1 });
    // This hook also runs when a provider reuses a WebSocket and has no new HTTP headers.
    started = performance.now(); firstToken = undefined; httpFailed = false;
    awaitingHeaders = true;
  });
  pi.on("before_provider_headers", (_event, ctx) => {
    if (!awaitingHeaders) {
      attempt++;
      if (attempt > 1) send(ctx, "codex.monitor.retry", { attempt: attempt - 1 });
    }
    started = performance.now(); firstToken = undefined; httpFailed = false;
    awaitingHeaders = false;
  });
  pi.on("after_provider_response", (event, ctx) => {
    if (event.status >= 400) {
      httpFailed = send(ctx, "codex.api_request", { "http.response.status_code": event.status, attempt: attempt - 1 });
    }
  });
  pi.on("message_update", (event) => {
    const update = event.assistantMessageEvent;
    if (started !== undefined && firstToken === undefined &&
        ["text_delta", "thinking_delta", "toolcall_delta"].includes(update.type) &&
        "delta" in update && String(update.delta).length > 0) {
      firstToken = performance.now();
    }
  });
  pi.on("message_end", (event, ctx) => {
    if (event.message.role !== "assistant") return;
    const message = event.message;
    if (message.stopReason === "error") {
      if (!httpFailed) send(ctx, "codex.api_request", {
        success: false, attempt: Math.max(0, attempt - 1),
        model: message.model || ctx.model?.id || "unknown",
        "codex.monitor.provider": message.provider || ctx.model?.provider || "unknown",
        "error.message": errorCategory(message.errorMessage || ""),
        ...(started !== undefined && firstToken !== undefined ? { ttft_ms: Math.max(0, firstToken - started) } : {}),
      });
    } else if (message.stopReason !== "aborted" && started !== undefined && firstToken !== undefined) {
      send(ctx, "codex.sse_event", {
        "event.kind": "response.completed",
        model: message.model,
        "codex.monitor.provider": message.provider,
        ttft_ms: Math.max(0, firstToken - started),
        input_token_count: message.usage.input + message.usage.cacheRead + message.usage.cacheWrite,
        cached_token_count: message.usage.cacheRead,
        output_token_count: message.usage.output,
        reasoning_token_count: (message.usage as any).reasoning || 0,
        ...((message as any).responseId ? { "response.id": (message as any).responseId } : {}),
      });
    }
    started = undefined; firstToken = undefined;
  });
  pi.on("agent_end", async () => { await Promise.allSettled(pending); });
  pi.on("session_shutdown", async () => { await Promise.allSettled(pending); });
}
