"use client";

import { useState, useTransition } from "react";
import { updateRule, applyRules, resetDisqualified } from "@/app/settings/quality-actions";

export type Rule = { id: string; kind: string; label: string; enabled: boolean; threshold: number | null; note: string | null };

const UNIT: Record<string, string> = { no_reply: "日", low_potential: "点未満" };

export function QualityRules({ rules, available, ngCount }: { rules: Rule[]; available: boolean; ngCount: number }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [local, setLocal] = useState<Record<string, { enabled: boolean; threshold: number | null }>>(
    Object.fromEntries(rules.map((r) => [r.id, { enabled: r.enabled, threshold: r.threshold }]))
  );

  const run = (fn: () => Promise<{ ok: boolean; error?: string; applied?: number }>, okMsg?: (n?: number) => string) =>
    start(async () => {
      const r = await fn();
      if (r.ok) setMsg(okMsg ? okMsg(r.applied) : "更新しました");
      else setMsg("エラー: " + (r.error ?? "失敗"));
    });

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6, flexWrap: "wrap", gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>🚦 品質ルール（NG指定・KPI母数の整流）</h3>
        <span className="muted" style={{ fontSize: 11 }}>現在のNG除外: {ngCount} 件</span>
      </div>
      <div className="muted" style={{ fontSize: 12, marginBottom: 12, lineHeight: 1.6 }}>
        該当する提案を「NG除外」にし、ダッシュボードの母数（有効リード）から外します。<b>接触前失注は自動で母数外</b>です。提案数が減っても質が上がっている指標です。
      </div>

      {!available ? (
        <div style={{ background: "var(--color-brand-25)", border: "1px solid var(--color-brand-100)", borderRadius: 10, padding: 14, fontSize: 12.5 }}>
          ルールテーブルが未作成です。SQL Editor で <span className="mono">supabase/quality.sql</span> を実行してください。
        </div>
      ) : (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {rules.map((r) => {
              const st = local[r.id];
              return (
                <div key={r.id} style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", padding: "10px 12px", border: "1px solid var(--color-border)", borderRadius: 10, opacity: st.enabled ? 1 : 0.6 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", minWidth: 180, flex: 1 }}>
                    <input type="checkbox" checked={st.enabled} disabled={pending}
                      onChange={(e) => { const v = e.target.checked; setLocal((m) => ({ ...m, [r.id]: { ...m[r.id], enabled: v } })); run(() => updateRule(r.id, { enabled: v })); }} />
                    <span><span style={{ fontSize: 13, fontWeight: 600 }}>{r.label}</span>{r.note && <div className="muted" style={{ fontSize: 11 }}>{r.note}</div>}</span>
                  </label>
                  {UNIT[r.kind] && (
                    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <input type="number" value={st.threshold ?? ""} disabled={pending}
                        onChange={(e) => setLocal((m) => ({ ...m, [r.id]: { ...m[r.id], threshold: e.target.value === "" ? null : Number(e.target.value) } }))}
                        onBlur={() => run(() => updateRule(r.id, { threshold: st.threshold }))}
                        style={{ width: 64, padding: "6px 8px", borderRadius: 8, border: "1px solid var(--color-border)", fontSize: 12.5 }} />
                      <span className="muted" style={{ fontSize: 11.5 }}>{UNIT[r.kind]}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
            <button onClick={() => run(applyRules, (n) => `${n ?? 0} 件をNG除外しました`)} disabled={pending} className="btn brand" style={{ fontSize: 13 }}>
              {pending ? "処理中…" : "ルールを今すぐ適用"}
            </button>
            <button onClick={() => { if (confirm("NG除外を全解除しますか？")) run(resetDisqualified, () => "NG除外を解除しました"); }} disabled={pending} className="btn" style={{ fontSize: 13 }}>
              全解除
            </button>
            {msg && <span style={{ fontSize: 12, color: msg.startsWith("エラー") ? "#b42318" : "#067647" }}>{msg}</span>}
          </div>
        </>
      )}
    </div>
  );
}
