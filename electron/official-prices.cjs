// Standard processing, SHORT context, USD per 1 million tokens.
// Do not use the adjacent Batch/Flex tables (50% of these rates).
// Verified 2026-09-09: https://developers.openai.com/api/docs/pricing
module.exports = {
  source: "Standard 标准价 · 短上下文 · 官网核对 2026-09-09",
  rates: [
    ["gpt-6-astra", 10, 1, 50, 12.5],
    ["gpt-5.6-sol", 4, 0.4, 20, 5],
    ["gpt-5.6-terra", 2, 0.2, 12, 2.5],
    ["gpt-5.6-luna", 0.2, 0.02, 1.2, 0.25],
  ],
};
