"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toggleFocus } from "@/lib/actions";
import { getFocusCriteria } from "@/app/settings/focus-actions";
import { buildFocusEntity, evaluateFocus, type FocusCriteria, type FocusEval } from "@/lib/focus-criteria";

// 注力定義は1ページ内で何度も使うのでモジュールキャッシュ（1回だけ取得）。
let _criteriaCache: FocusCriteria | null = null;
let _criteriaPromise: Promise<FocusCriteria> | null = null;
async function loadCriteria(): Promise<FocusCriteria> {
  if (_criteriaCache) return _criteriaCache;
  if (!_criteriaPromise) _criteriaPromise = getFocusCriteria().then((c) => (_criteriaCache = c));
  return _criteriaPromise;
}

/** 注力(ハート)トグル。ONにする時は注力定義との合致をチェックしてOK/キャンセルの確認を出す。 */
export function FocusHeart({
  table,
  idField,
  idValue,
  initial,
  revalidate,
  size = 16,
  row,
}: {
  table: "jobs" | "candidates";
  idField: "job_no" | "candidate_no";
  idValue: number;
  initial: boolean;
  revalidate?: string;
  size?: number;
  row?: any;
}) {
  const [on, setOn] = useState(initial);
  const [pending, start] = useTransition();
  const [checking, setChecking] = useState(false);
  const [confirm, setConfirm] = useState<{ ev: FocusEval; label: string } | null>(null);
  const router = useRouter();

  const commit = (v: boolean) => {
    setOn(v);
    start(async () => {
      const res = await toggleFocus(table, idField, idValue, v, revalidate);
      if (!res.ok) setOn(!v);
      router.refresh();
    });
  };

  const onClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (on) { commit(false); return; } // 解除は確認なし
    // ON にする時は注力定義チェック
    setChecking(true);
    try {
      const criteria = await loadCriteria();
      const rule = table === "jobs" ? criteria.jobs : criteria.candidates;
      const entity = buildFocusEntity(table, row ?? {});
      const ev = evaluateFocus(rule, entity);
      if (!ev.configured) { commit(true); return; } // 定義が未設定ならそのまま登録
      setConfirm({ ev, label: entity.label });
    } finally { setChecking(false); }
  };

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        disabled={pending || checking}
        title={on ? "注力から外す" : "注力に追加"}
        aria-pressed={on}
        style={{ border: 0, background: "transparent", cursor: "pointer", padding: 4, color: on ? "#e0567f" : "var(--color-ink-4)", lineHeight: 0, opacity: pending || checking ? 0.5 : 1 }}
      >
        <svg viewBox="0 0 16 16" width={size} height={size} fill={on ? "currentColor" : "none"} stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round">
          <path d="M8 13.5S2.5 10 2.5 6.2A2.7 2.7 0 018 4a2.7 2.7 0 015.5 2.2C13.5 10 8 13.5 8 13.5z" />
        </svg>
      </button>

      {confirm && (
        <div onClick={(e) => { e.stopPropagation(); setConfirm(null); }} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", display: "grid", placeItems: "center", zIndex: 400, padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "100%", maxWidth: 420, display: "flex", flexDirection: "column", gap: 12, textAlign: "left" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 22 }}>{confirm.ev.pass ? "✅" : "⚠️"}</span>
              <h3 style={{ margin: 0, fontSize: 15.5, fontWeight: 800 }}>{confirm.ev.pass ? "注力定義に合致しています" : "注力定義に合致していません"}</h3>
            </div>
            <div style={{ fontSize: 12.5, color: "var(--color-ink-2)" }}>
              <b>{confirm.label}</b> を注力（{table === "jobs" ? "案件" : "人材"}）に登録しますか？
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 6, background: "var(--color-surface-inset)", borderRadius: 10, padding: "10px 12px" }}>
              {confirm.ev.checks.length === 0 ? (
                <div style={{ fontSize: 12, color: "var(--color-ink-3)" }}>チェック条件は設定されていません。</div>
              ) : confirm.ev.checks.map((c, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                  <span style={{ color: c.pass ? "#1aa260" : "#d23f57", fontWeight: 800 }}>{c.pass ? "○" : "×"}</span>
                  <span style={{ fontWeight: 600 }}>{c.label}</span>
                  <span className="muted" style={{ marginLeft: "auto", fontSize: 11 }}>{c.detail}</span>
                </div>
              ))}
            </div>
            {confirm.ev.note.trim() && <div style={{ fontSize: 11.5, color: "var(--color-ink-3)" }}>📌 注力方針：{confirm.ev.note}</div>}
            {!confirm.ev.pass && <div style={{ fontSize: 11.5, color: "#b45309" }}>定義に合致していませんが、それでも登録できます。</div>}

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" className="btn ghost" onClick={() => setConfirm(null)}>キャンセル</button>
              <button type="button" className="btn brand" style={confirm.ev.pass ? undefined : { background: "#d98a2b", borderColor: "#d98a2b" }} onClick={() => { setConfirm(null); commit(true); }}>OK・注力に登録</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
