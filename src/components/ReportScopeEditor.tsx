"use client";

// 役職別の日報閲覧範囲（経営=全体 / マネージャー=部署 / メンバー=個人）。
//   管理者が役職ごとにスコープを選択し、app_settings に保存。日報ページに反映。

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveReportScopes } from "@/app/settings/permission-actions";
import {
  REPORT_ROLE_KEYS, REPORT_ROLE_LABEL,
  REPORT_SCOPE_LABEL, REPORT_SCOPE_HINT,
  type ReportScopes, type ReportScope,
} from "@/lib/report-scope";

export function ReportScopeEditor({ initial }: { initial: ReportScopes }) {
  const router = useRouter();
  const [scopes, setScopes] = useState<ReportScopes>(() => ({ ...initial }));
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [dirty, setDirty] = useState(false);

  const set = (rk: typeof REPORT_ROLE_KEYS[number], v: ReportScope) => {
    setScopes((s) => ({ ...s, [rk]: v }));
    setDirty(true);
  };

  const save = () => {
    setMsg(null);
    start(async () => {
      const r = await saveReportScopes(scopes);
      if (r.ok) { setMsg({ ok: true, text: "保存しました（日報ページに反映されます）" }); setDirty(false); router.refresh(); }
      else setMsg({ ok: false, text: r.error ?? "保存に失敗しました" });
    });
  };

  const tone: Record<ReportScope, { bg: string; fg: string; bd: string }> = {
    all:  { bg: "#efe7fb", fg: "#6b21a8", bd: "#d6c4f7" },
    dept: { bg: "#eaf4fd", fg: "#0b5cab", bd: "#cfe4f9" },
    self: { bg: "#f1f5f9", fg: "#475569", bd: "#cbd5e1" },
  };

  return (
    <div className="card">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6, flexWrap: "wrap", gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>📓 日報の閲覧範囲</h3>
        <span className="muted" style={{ fontSize: 11 }}>役職ごとに「誰の日報を見られるか」を設定</span>
      </div>
      <div className="muted" style={{ fontSize: 11.5, marginBottom: 12, lineHeight: 1.7 }}>
        対象は<b>エージェント</b>。<b>管理者は常に『全体』</b>を閲覧できます（ロックアウト防止）。
        部署スコープを使うには各メンバーに<b>部署を設定</b>してください（ユーザー管理→部署）。
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
        {REPORT_ROLE_KEYS.map((rk) => {
          const cur = scopes[rk];
          return (
            <div key={rk} style={{ border: `1px solid ${tone[cur].bd}`, background: tone[cur].bg, borderRadius: 10, padding: 12 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontWeight: 800, fontSize: 13, color: tone[cur].fg }}>{REPORT_ROLE_LABEL[rk]}</span>
                <span style={{ fontSize: 10.5, fontWeight: 700, color: tone[cur].fg, background: "#fff", borderRadius: 99, padding: "2px 8px", border: `1px solid ${tone[cur].bd}` }}>{REPORT_SCOPE_LABEL[cur]}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 6 }}>
                {(["all", "dept", "self"] as const).map((s) => {
                  const on = cur === s;
                  return (
                    <label key={s} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", borderRadius: 7, background: on ? "#fff" : "transparent", border: on ? `1px solid ${tone[s].bd}` : "1px solid transparent", cursor: "pointer", fontSize: 12 }}>
                      <input type="radio" name={`scope-${rk}`} value={s} checked={on} onChange={() => set(rk, s)} style={{ accentColor: tone[s].fg }} />
                      <span style={{ fontWeight: on ? 700 : 500, color: on ? tone[s].fg : "var(--color-ink-2)" }}>{REPORT_SCOPE_LABEL[s]}</span>
                    </label>
                  );
                })}
              </div>
              <div style={{ fontSize: 10.5, color: tone[cur].fg, lineHeight: 1.6 }}>{REPORT_SCOPE_HINT[cur]}</div>
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14 }}>
        <button type="button" className="btn brand" disabled={pending || !dirty} onClick={save}>{pending ? "保存中…" : "保存する"}</button>
        {dirty && <span className="muted" style={{ fontSize: 11.5, color: "#b45309" }}>未保存の変更があります</span>}
        {msg && <span style={{ fontSize: 12, color: msg.ok ? "#067647" : "var(--color-danger)" }}>{msg.text}</span>}
      </div>
    </div>
  );
}
