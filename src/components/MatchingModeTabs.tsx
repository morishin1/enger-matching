"use client";

// マッチング種別を1ブロックに集約：自動マッチング / 注力マッチング / ランキング100。
//   ・自動（既定）→ /matching?tab=auto
//   ・注力 → /matching?tab=focus。注力ビュー内で「番号で直接マッチング」も行える。
//   ・ランキング → /matching?tab=ranking
//   ・番号 → 案件NO/人材NO を入力して /matching?job=… / /matching?person=… へジャンプ
//     （旧「番号マッチング」タブは廃止し、注力ビュー内の入力欄に統合）
// マッチングページ本体の見た目をスリム化するための統合UI。

import { useState } from "react";
import Link from "@/components/AppLink";
import { useRouter, useSearchParams } from "next/navigation";

type Mode = "auto" | "focus" | "ranking";

export function MatchingModeTabs() {
  const router = useRouter();
  const sp = useSearchParams();
  // URL の tab からアクティブを判定。既定は自動（auto）。番号ジャンプ(job/person)後も自動扱い。
  const initialMode: Mode = (() => {
    const tab = sp?.get("tab");
    if (tab === "focus") return "focus";
    if (tab === "ranking") return "ranking";
    return "auto"; // tab 未指定・auto・番号ジャンプはすべて自動
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

  // 自動を先頭（既定）に。番号マッチングはタブ廃止し注力ビュー内の入力欄へ統合。
  //   注力は note の ★（ゴールド）・♡（赤）を着色して目立たせ、ランキングは先頭に👑を付ける。
  // ランキング100は運用で使わないため非表示（/matching?tab=ranking のページ自体は残置）。
  const TABS: { key: Mode; label: React.ReactNode; note: React.ReactNode; href?: string }[] = [
    { key: "auto",    label: "自動マッチング", note: "全案件・全人材",     href: "/matching?tab=auto" },
    { key: "focus",   label: "注力マッチング", href: "/matching?tab=focus",
      note: <><span style={{ color: "#f0a92b" }}>★</span> <span style={{ color: "#e0245e" }}>♡</span>・プロパー・新着</> },
  ];

  const inputStyle: React.CSSProperties = {
    fontSize: 13, padding: "7px 10px", border: "1px solid var(--color-border-strong)",
    borderRadius: 8, background: "var(--color-surface)", width: 130,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0, marginBottom: 12 }}>
      {/* モードタブ */}
      <div role="tablist" style={{ display: "flex", gap: 4, padding: 3, background: "var(--color-surface-inset)", borderRadius: 99, alignSelf: "flex-start" }}>
        {TABS.map((t) => {
          const on = mode === t.key;
          const content = (
            // #316①：選択中のタブは背景色（ブランド色）を付けて区別しやすくする。
            //   文字も少し大きめ（14px）にする。未選択は従来どおり控えめに。
            <span style={{
              display: "inline-flex", flexDirection: "column", alignItems: "flex-start",
              padding: "7px 18px", borderRadius: 99, lineHeight: 1.3,
              background: on ? "var(--color-brand-600)" : "transparent",
              color: on ? "#fff" : "var(--color-ink-3)",
              fontSize: 14, fontWeight: on ? 700 : 600,
              boxShadow: on ? "0 1px 3px rgba(15,23,42,0.18)" : "none",
              transition: "background .12s ease, color .12s ease",
            }}>
              <span>{t.label}</span>
              <span style={{ fontSize: 10, fontWeight: 500, color: on ? "rgba(255,255,255,0.82)" : "var(--color-ink-4)", fontFamily: "var(--font-mono)" }}>{t.note}</span>
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

      {/* 番号で直接マッチング（注力ビュー内に統合。旧「番号マッチング」タブの代替）。 */}
      {mode === "focus" && (
        <div className="card" style={{ marginTop: 8, display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center", padding: "10px 14px" }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--color-ink-2)" }}>番号で直接マッチング</span>
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
