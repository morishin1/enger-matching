"use client";

// マッチング種別を1ブロックに集約：自動マッチング / 注力マッチング / 番号マッチング。
//   従来は3カ所に分散していた UI（自動/注力タブ、番号入力フォーム）をタブで切替。
//   ・自動 → /matching?tab=auto
//   ・注力 → /matching?tab=focus
//   ・番号 → 案件NO/人材NO を入力して /matching?job=… / /matching?person=… へジャンプ
// マッチングページ本体の見た目をスリム化するための統合UI。

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

type Mode = "auto" | "focus" | "number";

export function MatchingModeTabs() {
  const router = useRouter();
  const sp = useSearchParams();
  // URL の tab / job / person からアクティブを判定
  const initialMode: Mode = (() => {
    const tab = sp?.get("tab");
    if (tab === "focus") return "focus";
    if (sp?.get("job") || sp?.get("person")) return "auto"; // ジャンプ後は自動扱い
    return (tab === "auto" ? "auto" : "auto");
  })();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [job, setJob] = useState("");
  const [person, setPerson] = useState("");

  const numOf = (v: string) => {
    const n = parseInt((v || "").replace(/[^\d]/g, ""), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const goJob = () => { const n = numOf(job); if (n) router.push(`/matching?job=${n}`); };
  const goPerson = () => { const n = numOf(person); if (n) router.push(`/matching?person=${n}`); };

  const TABS: { key: Mode; label: string; note: string; href?: string }[] = [
    { key: "auto",   label: "自動マッチング", note: "全案件・全人材",     href: "/matching?tab=auto" },
    { key: "focus",  label: "注力マッチング", note: "★ ♡・プロパー・新着", href: "/matching?tab=focus" },
    { key: "number", label: "番号マッチング", note: "案件No / 人材No" },
  ];

  const inputStyle: React.CSSProperties = {
    fontSize: 13, padding: "7px 10px", border: "1px solid var(--color-border-strong)",
    borderRadius: 8, background: "var(--color-surface)", width: 130,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0, marginBottom: 12 }}>
      {/* タブ */}
      <div role="tablist" style={{ display: "flex", gap: 4, padding: 3, background: "var(--color-surface-inset)", borderRadius: 99, alignSelf: "flex-start" }}>
        {TABS.map((t) => {
          const on = mode === t.key;
          const content = (
            <span style={{
              display: "inline-flex", flexDirection: "column", alignItems: "flex-start",
              padding: "6px 16px", borderRadius: 99, lineHeight: 1.3,
              background: on ? "var(--color-surface)" : "transparent",
              color: on ? "var(--color-ink)" : "var(--color-ink-3)",
              fontSize: 13, fontWeight: 600,
              boxShadow: on ? "0 1px 2px rgba(15,23,42,0.08)" : "none",
            }}>
              <span>{t.label}</span>
              <span style={{ fontSize: 10, fontWeight: 500, color: "var(--color-ink-4)", fontFamily: "var(--font-mono)" }}>{t.note}</span>
            </span>
          );
          // 自動/注力タブはURL遷移、番号タブはステート切替のみ（入力欄を出すため）
          return t.href ? (
            <Link key={t.key} role="tab" aria-selected={on} href={t.href}
              style={{ textDecoration: "none" }}
              onClick={() => setMode(t.key)}>
              {content}
            </Link>
          ) : (
            <button key={t.key} type="button" role="tab" aria-selected={on}
              style={{ background: "transparent", border: 0, cursor: "pointer", fontFamily: "inherit", padding: 0 }}
              onClick={() => setMode(t.key)}>
              {content}
            </button>
          );
        })}
      </div>

      {/* 番号マッチングの入力欄（タブ選択時のみ表示） */}
      {mode === "number" && (
        <div className="card" style={{ marginTop: 8, display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center", padding: "10px 14px" }}>
          <form onSubmit={(e) => { e.preventDefault(); goJob(); }} style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <label style={{ fontSize: 12, color: "var(--color-ink-3)" }}>案件NO</label>
            <input type="text" inputMode="numeric" placeholder="例：123" value={job} onChange={(e) => setJob(e.target.value)} style={inputStyle} />
            <button type="submit" className="btn brand btn-xs" disabled={!numOf(job)}>この案件で人材を探す</button>
          </form>
          <form onSubmit={(e) => { e.preventDefault(); goPerson(); }} style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <label style={{ fontSize: 12, color: "var(--color-ink-3)" }}>人材NO</label>
            <input type="text" inputMode="numeric" placeholder="例：456" value={person} onChange={(e) => setPerson(e.target.value)} style={inputStyle} />
            <button type="submit" className="btn brand btn-xs" disabled={!numOf(person)}>この人材で案件を探す</button>
          </form>
          <span className="muted" style={{ fontSize: 10.5 }}>※ 一覧のID（No.XXXXX / P-XXXXX）の数字部分。注力に入っていなくても直接マッチング可</span>
        </div>
      )}
    </div>
  );
}
