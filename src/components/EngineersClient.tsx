"use client";

import { useMemo, useState } from "react";
import type { Engineer } from "@/lib/engineers";

const pay = (e: Engineer) => {
  const lo = e.estimated_pay_low, hi = e.estimated_pay_high, mid = e.estimated_pay_mid;
  if (lo && hi) return `¥${lo}〜${hi}万`;
  if (mid) return `¥${mid}万`;
  return "—";
};
const skillNames = (e: Engineer) => (e.skills ?? []).map((s) => s.name).filter(Boolean);

export function EngineersClient({ engineers }: { engineers: Engineer[] }) {
  const [q, setQ] = useState("");
  const [detail, setDetail] = useState<Engineer | null>(null);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return engineers;
    return engineers.filter((e) => [e.display_name, e.github_login, e.primary_language, ...skillNames(e)].filter(Boolean).join(" ").toLowerCase().includes(t));
  }, [q, engineers]);

  if (engineers.length === 0) {
    return <div className="card" style={{ textAlign: "center", color: "var(--color-ink-4)", padding: 40, fontSize: 13 }}>まだ enger.jp 経由で登録したエンジニアがいません。</div>;
  }

  return (
    <>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <div className="tbl-search" style={{ width: 260, flex: "0 0 260px" }}><input placeholder="氏名・スキル・言語で検索…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <span className="muted" style={{ fontSize: 11.5 }}>{filtered.length} 名</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
        {filtered.map((e) => (
          <button key={e.id} onClick={() => setDetail(e)} className="card" style={{ textAlign: "left", cursor: "pointer", padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {e.avatar_url ? <img src={e.avatar_url} alt="" style={{ width: 42, height: 42, borderRadius: 99, flex: "0 0 42px" }} /> : <div className="ava" style={{ width: 42, height: 42, flex: "0 0 42px" }}>{(e.display_name ?? e.github_login ?? "?").slice(0, 2)}</div>}
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.display_name || e.github_login || "—"}</div>
                <div className="muted" style={{ fontSize: 11 }}>{e.github_login ? `@${e.github_login}` : ""} · {e.primary_language ?? "—"}</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              {skillNames(e).slice(0, 6).map((s) => <span key={s} className="tag" style={{ fontSize: 10.5, background: "var(--color-brand-25)", color: "var(--color-brand-700,#0b5cab)" }}>{s}</span>)}
            </div>
            <div style={{ display: "flex", gap: 14, fontSize: 11.5, color: "var(--color-ink-3)", borderTop: "1px solid var(--color-border)", paddingTop: 8 }}>
              <span>想定単価 <b style={{ color: "var(--color-ink)" }}>{pay(e)}</b></span>
              <span>★{e.total_stars}</span>
              <span>repo {e.total_repos}</span>
            </div>
          </button>
        ))}
      </div>

      {detail && (
        <div onClick={() => setDetail(null)} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", display: "grid", placeItems: "center", zIndex: 300, padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "100%", maxWidth: 560, maxHeight: "88vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {detail.avatar_url ? <img src={detail.avatar_url} alt="" style={{ width: 48, height: 48, borderRadius: 99 }} /> : <div className="ava" style={{ width: 48, height: 48 }}>{(detail.display_name ?? "?").slice(0, 2)}</div>}
                <div>
                  <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>{detail.display_name || detail.github_login}</h3>
                  <div className="muted" style={{ fontSize: 12 }}>{detail.github_login ? <a href={`https://github.com/${detail.github_login}`} target="_blank" rel="noreferrer" style={{ color: "var(--color-brand-700,#0b5cab)" }}>@{detail.github_login}</a> : ""} · {detail.primary_language ?? "—"}</div>
                </div>
              </div>
              <button className="btn ghost btn-xs" onClick={() => setDetail(null)}>閉じる</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 1, background: "var(--color-border)", border: "1px solid var(--color-border)", borderRadius: 10, overflow: "hidden" }}>
              {[["想定単価", pay(detail)], ["★ Stars", detail.total_stars], ["リポジトリ", detail.total_repos]].map(([l, v], i) => (
                <div key={i} style={{ background: "var(--color-surface)", padding: "9px 11px" }}><div style={{ fontSize: 10, color: "var(--color-ink-4)", fontWeight: 600 }}>{l}</div><div style={{ fontSize: 14, fontWeight: 700, marginTop: 2 }}>{String(v)}</div></div>
              ))}
            </div>
            <div>
              <div style={{ fontSize: 11, color: "var(--color-ink-4)", fontWeight: 600, marginBottom: 5 }}>スキル（GitHub解析）</div>
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                {skillNames(detail).length === 0 ? <span className="muted" style={{ fontSize: 12 }}>—</span> : (detail.skills ?? []).slice(0, 20).map((s) => (
                  <span key={s.name} className="tag" style={{ fontSize: 11 }}>{s.name}{s.level ? ` (${s.level})` : ""}</span>
                ))}
              </div>
            </div>
            {detail.email && <div style={{ fontSize: 12, color: "var(--color-ink-3)" }}>連絡先：{detail.email}</div>}
            <div className="muted" style={{ fontSize: 10.5 }}>※ enger.jp（GitHub連携）で本人が登録したプロフィールです。</div>
          </div>
        </div>
      )}
    </>
  );
}
