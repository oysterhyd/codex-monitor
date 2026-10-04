import {tr, dateFormat, systemText} from "./i18n.mjs";
// Each option set is built once: the render path formats hundreds of values per update
// and an Intl constructor costs ~20-35x formatting a single value.
const compactFormat = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 2,
});
const fullFormat = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });
const moneyFormat = new Intl.NumberFormat("en", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const recordMoneyFormat = new Intl.NumberFormat("en", {
  minimumFractionDigits: 4,
  maximumFractionDigits: 6,
});
const DATE_OPTIONS = {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
};
// The key identifies the option set; dateFormat caches one formatter per key+language.
export const TICK_FORMATS = {
  tickDay: { month: "2-digit", day: "2-digit" },
  tickTime: { hour: "2-digit", minute: "2-digit", hour12: false },
};
export const compact = (n) => (n == null ? "—" : compactFormat.format(n));
export const full = (n) => (n == null ? "—" : fullFormat.format(n));
export const money = (n) => (n == null ? "—" : "$" + moneyFormat.format(n));
// Keep the existing unpriced suffix consistent across charts, ranks and day details.
export const moneyLabel = (n, unpriced) => money(n) + (unpriced ? tr(" + 未定价") : "");
export const pct = (n) => (n == null ? "—" : (n * 100).toFixed(1) + "%");
export const wholePercent = (n) => (n == null ? "—" : n.toFixed(0) + "%");
export const recordMoney = (n, t) => !t.requests ? "—" : n == null ? tr("未定价") :
  "$" + recordMoneyFormat.format(n) + (t.unpriced ? tr(" + 未定价") : "");
export const date = (t) => t ? dateFormat("short", DATE_OPTIONS).format(new Date(t)) : "—";
export const duration = (n) =>
  n == null
    ? "—"
    : n < 60000
      ? (n / 1000).toFixed(1) + tr(" 秒")
      : (n / 60000).toFixed(1) + tr(" 分钟");
export const shortPath = (p) => p === "未归属项目" ? systemText(p) : p?.split(/[\\/]/).filter(Boolean).at(-1) || p;

// Asked for at call time so a change to the OS setting is honoured without a reload.
export const prefersReducedMotion = () =>
  typeof matchMedia === "function" &&
  matchMedia("(prefers-reduced-motion: reduce)").matches;
