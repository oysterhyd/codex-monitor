import test from "node:test";
import assert from "node:assert/strict";
import codexMonitor from "./codex-monitor.ts";

test("Pi measures first content, groups retries and exports no message bodies", async () => {
  const originalFetch = globalThis.fetch;
  const originalNow = performance.now;
  const originalEndpoint = process.env.CODEX_MONITOR_OTEL_URL;
  delete process.env.CODEX_MONITOR_OTEL_URL;
  let clock = 0;
  const sent = [];
  const hooks = {};
  Object.defineProperty(performance, "now", { configurable: true, value: () => clock });
  globalThis.fetch = async (_url, options) => { sent.push(JSON.parse(options.body)); return { ok: true }; };
  try {
    codexMonitor({ on: (name, fn) => { hooks[name] = fn; } });
    const ctx = { sessionManager: { getSessionId: () => "test-session" }, model: { id: "gpt-5.5", provider: "openai-codex" } };
    hooks.turn_start({}, ctx);
    clock = 100;
    hooks.before_provider_headers({ headers: { Authorization: "SECRET TOKEN" } }, ctx);
    hooks.after_provider_response({ status: 429, headers: { Authorization: "SECRET TOKEN" } }, ctx);
    clock = 200;
    hooks.before_provider_headers({ headers: {} }, ctx);
    hooks.after_provider_response({ status: 200, headers: {} }, ctx);
    clock = 500;
    hooks.message_update({ assistantMessageEvent: { type: "text_start", content: "SECRET CONTENT" } }, ctx);
    clock = 5000;
    hooks.message_update({ assistantMessageEvent: { type: "text_delta", delta: "SECRET CONTENT" } }, ctx);
    clock = 7000;
    hooks.message_end({ message: { role: "assistant", model: "gpt-5.5", provider: "openai-codex", responseId: "resp_pi", stopReason: "stop", content: "SECRET CONTENT", usage: { input: 1000, cacheRead: 400, cacheWrite: 0, output: 100 } } }, ctx);
    await hooks.agent_end({}, ctx);
    const events = sent.map(payload => Object.fromEntries(payload.resourceLogs[0].scopeLogs[0].logRecords[0].attributes.map(attr => [attr.key, attr.value.stringValue])));
    assert.deepEqual(events.map(event => event["event.name"]), ["codex.api_request", "codex.monitor.retry", "codex.sse_event"]);
    assert.equal(events[2].ttft_ms, "4800");
    assert.equal(events[2].input_token_count, "1400");
    assert.equal(events[2]["response.id"], "resp_pi");
    assert.equal(new Set(events.map(event => event["codex.monitor.request_id"])).size, 1);
    assert.ok(!JSON.stringify(sent).includes("SECRET"));

    hooks.turn_start({}, ctx);
    hooks.message_end({ message: { role: "assistant", stopReason: "error", errorMessage: "SECRET ERROR" } }, ctx);
    await hooks.agent_end({}, ctx);
    assert.ok(!JSON.stringify(sent).includes("SECRET"));

    // A missing provider start must remain unknown; do not time from a UI/turn event.
    const before = sent.length;
    hooks.turn_start({}, ctx);
    hooks.message_update({ assistantMessageEvent: { type: "text_delta", delta: "content" } }, ctx);
    hooks.message_end({ message: { role: "assistant", stopReason: "stop" } }, ctx);
    await hooks.agent_end({}, ctx);
    assert.equal(sent.length, before);

    // Reused WebSocket requests may not assemble HTTP headers again.
    hooks.turn_start({}, ctx);
    clock = 100;
    hooks.before_provider_request({ payload: "SECRET PAYLOAD" }, ctx);
    clock = 1100;
    hooks.message_update({ assistantMessageEvent: { type: "thinking_delta", delta: "SECRET THINKING" } }, ctx);
    hooks.message_end({ message: { role: "assistant", stopReason: "error", errorMessage: "connection lost SECRET TOKEN" } }, ctx);
    await hooks.agent_end({}, ctx);
    const failed = Object.fromEntries(sent.at(-1).resourceLogs[0].scopeLogs[0].logRecords[0].attributes.map(attr => [attr.key, attr.value.stringValue]));
    assert.equal(failed.ttft_ms, "1000");
    assert.equal(failed["error.message"], "connection");
    assert.ok(!JSON.stringify(sent).includes("SECRET"));

    const beforeRemote = sent.length;

    process.env.CODEX_MONITOR_OTEL_URL = "https://example.com/v1/logs";
    hooks.turn_start({}, ctx);
    hooks.message_end({ message: { role: "assistant", stopReason: "error" } }, ctx);
    await hooks.agent_end({}, ctx);
    assert.equal(sent.length, beforeRemote);
  } finally {
    globalThis.fetch = originalFetch;
    Object.defineProperty(performance, "now", { configurable: true, value: originalNow });
    if (originalEndpoint === undefined) delete process.env.CODEX_MONITOR_OTEL_URL;
    else process.env.CODEX_MONITOR_OTEL_URL = originalEndpoint;
  }
});
