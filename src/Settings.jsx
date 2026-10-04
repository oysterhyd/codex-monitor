import React, { useState, useEffect } from "react";
import {Sun, Monitor as MonitorIcon, Moon, FolderOpen} from "@phosphor-icons/react";
import { tr, systemText } from "./i18n.mjs";
import {date} from "./format.mjs";
import {Panel} from "./components.jsx";
const api = window.monitor;
function AccountManager({ data, act, busy }) {
  const [label, setLabel] = useState("");
  return <Panel title={tr("账号管理")} className="settings-wide section-accounts">
    <p>{tr("自动识别本机登录账号；仅保存账号标识摘要和显示名称，不保存登录凭据。可添加历史账号并修改显示名称。")}</p>
    <form className="button-row" onSubmit={e => { e.preventDefault(); act(async () => { const result = await api.account({ label }); setLabel(""); return result; }, tr("账号已保存")); }}>
      <input aria-label={tr("账号名称")} placeholder={tr("账号名称")} required maxLength={100} value={label} onChange={e => setLabel(e.target.value)} />
      <button className="button" disabled={busy || !label.trim()}>{tr("添加账号")}</button>
    </form>
    {(data.accounts || []).map(a => <AccountName key={a.id} account={a} current={a.id === data.currentAccount} act={act} busy={busy} />)}
  </Panel>;
}
function AccountName({ account, current, act, busy }) {
  const [label, setLabel] = useState(account.label);
  return <form className="setting-row" onSubmit={e => { e.preventDefault(); act(() => api.account({ id: account.id, label }), tr("账号已保存")); }}>
    <input aria-label={`${tr("账号名称")} ${account.id.slice(0, 6)}`} required maxLength={100} value={label} onChange={e => setLabel(e.target.value)} />
    <span>{account.id.slice(0, 6)}{current ? ` · ${tr("当前登录")}` : ""}</span>
    <button className="button" disabled={busy || label === account.label || !label.trim()}>{tr("保存")}</button>
  </form>;
}

const EMPTY_PRICE = {
  model: "",
  input: "",
  cached: "",
  output: "",
  cache_write: "0",
  effective: "1970-01-01T00:00",
};
// A store ISO stamp → the <input type="datetime-local"> value (local, minute precision).
const toLocalInput = (iso) => {
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

export function Settings({ data, act, busy, initialSection = "general" }) {
  const [section, setSection] = useState(initialSection);
  useEffect(() => setSection(initialSection), [initialSection]);
  const [price, setPrice] = useState(EMPTY_PRICE);
  const [editingPriceId, setEditingPriceId] = useState(null);
  const set = (k, v) => setPrice((p) => ({ ...p, [k]: v }));
  // A price row → the editable form shape (numeric fields as-is, effective converted
  // to the datetime-local value); callers override `effective` for "use as template".
  const setPriceShape = (p) => ({
    model: p.model,
    input: p.input,
    cached: p.cached,
    output: p.output,
    cache_write: p.cache_write,
    effective: toLocalInput(p.effective),
  });
  return (
    <div className={`settings-layout settings-${section}`}>
      <div className="settings-tabs" role="group" aria-label={tr("设置分类")}>{[["general",tr("通用")],["accounts",tr("账号")],["prices",tr("模型价格")],["data",tr("数据与存储")]].map(([key,label]) => <button className={section === key ? "active" : ""} aria-pressed={section === key} key={key} onClick={() => setSection(key)}>{label}</button>)}</div>
      <Panel title={tr("外观与后台")} className="section-general settings-wide">
        <div className="setting-row">
          <div><b>{tr("语言")}</b><small>{tr("界面语言立即生效，并在下次启动时保留")}</small></div>
          <select aria-label={tr("语言")} value={data.settings.language || "zh-CN"}
            disabled={busy} onChange={e => act(() => api.settings({ language: e.target.value }))}>
            <option value="zh-CN">简体中文</option><option value="en">English</option>
          </select>
        </div>
        <div className="setting-row">
          <div>
            <b>{tr("主题")}</b>
          </div>
          <div className="segmented" role="group" aria-label={tr("主题")}>
            {[
              ["system", MonitorIcon, tr("系统")],
              ["light", Sun, tr("浅色")],
              ["dark", Moon, tr("深色")],
            ].map(([id, Icon, name]) => (
              <button
                key={id}
                disabled={busy}
                aria-pressed={data.settings.theme === id}
                className={data.settings.theme === id ? "active" : ""}
                onClick={() => act(() => api.settings({ theme: id }))}
              >
                <Icon size={16} />
                {name}
              </button>
            ))}
          </div>
        </div>
        <div className="setting-row">
          <div>
            <b>{tr("开机启动")}</b>
            <small>{tr("登录 Windows 后静默进入托盘")}</small>
          </div>
          <input
            aria-label={tr("开机启动")}
            type="checkbox"
            role="switch"
            disabled={busy}
            checked={data.settings.autoStart}
            onChange={(e) =>
              act(() => api.settings({ autoStart: e.target.checked }))
            }
          />
        </div>
        <div className="setting-row">
          <div>
            <b>{tr("静音额度提醒")}</b>
            <small>{tr("剩余 20% 和 10% 时提醒")}</small>
          </div>
          <input
            aria-label={tr("静音额度提醒")}
            type="checkbox"
            role="switch"
            disabled={busy}
            checked={data.settings.muted}
            onChange={(e) =>
              act(() => api.settings({ muted: e.target.checked }))
            }
          />
        </div>
        <div className="setting-row">
          <div>
            <b>{tr("额度查询间隔")}</b>
          </div>
          <select
            aria-label={tr("额度查询间隔")}
            disabled={busy}
            value={data.settings.quotaInterval}
            onChange={(e) =>
              act(() => api.settings({ quotaInterval: Number(e.target.value) }))
            }
          >
            {[60, 120, 300].map((n) => (
              <option key={n} value={n}>
                {n / 60}{tr("分钟")}</option>
            ))}
          </select>
        </div>
      </Panel>
      <Panel title={tr("数据来源")} className="section-data settings-wide">
        <div className="path-row">
          <span>{tr("Codex 数据目录")}</span>
          <code>{data.paths.home}</code>
        </div>
        <div className="path-row">
          <span>{tr("pi 会话目录")}</span>
          <code>{data.paths.piSessions || "—"}</code>
        </div>
        <p className="panel-note">{tr("自动统计 pi 中官方登录的 Codex 用量，不含 API Key 和其他供应商。历史账号无法确认时保留为未归属，不改变额度查询来源。")}</p>
        <div className="path-row">
          <span>{tr("监测数据库目录")}</span>
          <code>{data.paths.data}</code>
        </div>
        <div className="path-row">
          <span>{tr("额度查询程序")}</span>
          <code>
            {data.settings.codexExecutable || tr("自动发现本机 Codex App Server")}
          </code>
        </div>
        <div className="button-row">
          <button
            className="button"
            onClick={() =>
              act(async () => {
                const p = await api.pickExecutable();
                if (p) return api.settings({ codexExecutable: p });
                return null;
              }, tr("查询程序已更新"))
            }
          >
            <FolderOpen size={16} />{tr("选择 codex.exe")}</button>
          <button
            className="button"
            onClick={() =>
              act(() => api.settings({ codexExecutable: "" }), tr("已恢复自动发现"))
            }
          >{tr("恢复自动发现")}</button>
          <button className="button" disabled={busy} onClick={() => act(() => api.openData())}>{tr("打开数据目录")}</button>
        </div>
      </Panel>
      <Panel title={tr("模型价格")} meta={tr("USD / 百万 tokens")} className="settings-wide section-prices">
        <div className="notice">{tr("按 API 标准价估算，不代表订阅账单。")}</div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const id = editingPriceId;
            act(
              async () => {
                const result = await api.price({
                  ...(id === null ? {} : { id }),
                  ...price,
                  input: Number(price.input),
                  cached: Number(price.cached),
                  output: Number(price.output),
                  cache_write: Number(price.cache_write),
                  effective: new Date(price.effective).toISOString(),
                });
                setEditingPriceId(null);
                setPrice(EMPTY_PRICE);
                return result;
              },
              tr(id === null ? "价格版本已保存" : "价格版本已更新"),
            );
          }}
        >
          <div className="price-form">
            <label>{tr("模型")}<input
                list="model-options"
                required
                placeholder={tr("例如 gpt-5.5")}
              value={price.model}
              onChange={(e) => set("model", e.target.value)}
              />
              <datalist id="model-options">
                {data.options.models.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </label>
            {[
              ["input", tr("普通输入")],
              ["cached", tr("缓存输入")],
              ["output", tr("输出")],
              ["cache_write", tr("缓存写入")],
            ].map(([k, t]) => (
              <label key={k}>
                {t}
                <input
                  required
                  type="number"
                  min="0"
                  max="100000"
                  step="any"
                  value={price[k]}
                  onChange={(e) => set(k, e.target.value)}
                />
              </label>
            ))}
            <label>{tr("生效时间")}<input
                required
                type="datetime-local"
                value={price.effective}
                onChange={(e) => set("effective", e.target.value)}
              />
            </label>
          </div>
          <div className="price-form-actions">
            <button className="button primary" type="submit" disabled={busy}>
              {editingPriceId === null ? tr("保存价格版本") : tr("保存修改")}
            </button>
            {editingPriceId !== null && <button className="button" type="button" disabled={busy} onClick={() => { setEditingPriceId(null); setPrice(EMPTY_PRICE); }}>{tr("取消编辑")}</button>}
          </div>
        </form>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>{tr("模型 / 版本")}</th>
                <th>{tr("输入")}</th>
                <th>{tr("缓存")}</th>
                <th>{tr("输出")}</th>
                <th>{tr("写入")}</th>
                <th>{tr("生效时间")}</th>
                <th>{tr("操作")}</th>
              </tr>
            </thead>
            <tbody>
              {data.prices
                .filter((p) => !p.retired)
                .map((p) => (
                  <tr key={p.id}>
                    <td>
                      <button
                        className="table-link"
                        onClick={() => {
                          setEditingPriceId(null);
                          // "Use as template" keeps the row's rates but today's date:
                          // the new version starts effective now, not at the original's date.
                          setPrice({...setPriceShape(p), effective: new Date().toLocaleDateString("en-CA") + "T00:00"});
                        }}
                      >
                        {p.model}{" "}
                        <small>
                          v{p.id} · {systemText(p.source)}
                        </small>
                      </button>
                    </td>
                    <td>${p.input}</td>
                    <td>${p.cached}</td>
                    <td>${p.output}</td>
                    <td>${p.cache_write}</td>
                    <td>
                      {p.effective.startsWith("1970")
                        ? tr("全部历史基准")
                        : date(p.effective)}
                    </td>
                    <td>
                      {p.source === "手动设置" ? (
                        <div className="price-actions">
                          <button className="button" type="button" disabled={busy} onClick={() => {
                            setEditingPriceId(p.id);
                            setPrice(setPriceShape(p));
                          }}>{tr("编辑")}</button>
                          <button className="button danger" type="button" disabled={busy} onClick={() => act(async () => {
                            const result = await api.deletePrice({ id: p.id, model: p.model });
                            if (result && editingPriceId === p.id) {
                              setEditingPriceId(null);
                              setPrice(EMPTY_PRICE);
                            }
                            return result;
                          }, tr("价格版本已删除"))}>{tr("删除")}</button>
                        </div>
                      ) : "—"}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <AccountManager data={data} act={act} busy={busy} />
      <Panel title={tr("历史管理")} className="settings-wide section-data">
        <div className="setting-row">
          <div>
            <b>{tr("清空监测历史")}</b>
            <small>{tr("只删除本应用统计；Codex 与 pi 原始记录、价格和设置保留。之后仅采集新增记录。")}</small>
          </div>
          <button
            className="button danger"
            disabled={busy}
            onClick={() => act(() => api.clear(), tr("监测历史已清空"))}
          >{tr("清空历史")}</button>
        </div>
        {data.settings.clearedAt && (
          <p className="panel-note">{tr("上次清空：")}{date(data.settings.clearedAt)}
          </p>
        )}
      </Panel>
    </div>
  );
}
