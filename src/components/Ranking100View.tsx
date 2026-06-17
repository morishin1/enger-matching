"use client";

// ランキング100：必須スキル一致率75%以上の案件×人材ペアを上位100件表示。
//   行クリックで「案件×人材を横並びで比較」できるドロワーを開く。
//   ・左：案件詳細／右：人材詳細／上部：一致スキル・案件のみ・人材のみのスキル比較。
//   ・ドロワーから「→ 提案画面」「案件ページへ」「人材ページへ」も開ける。

import Link from "next/link";
import { useEffect, useState } from "react";
import type { RankedPair, DimStatus } from "@/lib/ranking100";

/** 5次元(スキル/単価/時期/年代/勤務)の充足を細いバーで表示。
 *   ・known=false（情報不明）はグレー表示にし、満点に届かない理由を視覚化する。
 *   ・ボーナスがあれば右に「+N」を付与（営業支援/業界経験/尚可スキル等）。 */
function DimMiniBar({ dims, bonus }: { dims: { skill: DimStatus; salary: DimStatus; remote: DimStatus; timing: DimStatus; age: DimStatus }; bonus: number }) {
  const items: { label: string; full: string; d: DimStatus }[] = [
    { label: "ス", full: "必須スキル", d: dims.skill },
    { label: "単", full: "単価",       d: dims.salary },
    { label: "時", full: "稼働時期",   d: dims.timing },
    { label: "年", full: "年代",       d: dims.age },
    { label: "勤", full: "勤務形態",   d: dims.remote },
  ];
  const colorOf = (d: DimStatus) => {
    if (!d.known) return "#cbd5e1";        // 不明：グレー
    if (d.pct >= 95) return "#067647";     // ほぼ満点：緑
    if (d.pct >= 70) return "#0b5cab";     // 良好：青
    if (d.pct >= 40) return "#b45309";     // 注意：黄褐色
    return "#b42318";                      // 不一致：赤
  };
  return (
    <div title={`内訳：${items.map((it) => `${it.full} ${it.d.known ? `${it.d.pct}%` : "不明"}`).join(" / ")}${bonus > 0 ? ` ／ ボーナス +${bonus}` : ""}`}
      style={{ display: "inline-flex", gap: 2, alignItems: "center", marginTop: 3, justifyContent: "flex-end" }}>
      {items.map((it) => (
        <span key={it.label} style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
          <span style={{ display: "block", width: 12, height: 4, borderRadius: 2, background: colorOf(it.d), opacity: it.d.known ? 1 : 0.5 }} />
          <span style={{ fontSize: 8.5, color: it.d.known ? "var(--color-ink-4)" : "#9aa7b4", fontWeight: 600 }}>{it.label}</span>
        </span>
      ))}
      {bonus > 0 && (
        <span style={{ fontSize: 10, fontWeight: 800, color: "#0095D9", marginLeft: 3, padding: "1px 5px", borderRadius: 4, background: "#e0f2fe" }}>+{bonus}</span>
      )}
    </div>
  );
}

const salaryLabel = (lo?: number | null, hi?: number | null) =>
  lo && hi ? (lo === hi ? `¥${lo}万` : `¥${lo}〜${hi}万`) : hi ? `〜¥${hi}万` : lo ? `¥${lo}万〜` : "—";
const remoteLabel = (r?: string | null) =>
  r === "full_remote" ? "フルリモート" : r === "partial_remote" ? "一部リモート" : r === "onsite" ? "出社" : (r || "—");

function RankBadge({ n }: { n: number }) {
  const color = n === 1 ? "#f0a92b" : n === 2 ? "#9aa7b4" : n === 3 ? "#cd853f" : "var(--color-surface-inset)";
  const fg = n <= 3 ? "#fff" : "var(--color-ink-3)";
  return (
    <span style={{ display: "inline-grid", placeItems: "center", width: 28, height: 28, borderRadius: 99, background: color, color: fg, fontSize: 12, fontWeight: 800, fontFamily: "var(--font-display)" }}>{n}</span>
  );
}

export function Ranking100View({ rows, meta, title, subtitle }: { rows: RankedPair[]; meta: { jobsScanned: number; candsScanned: number; pairsHit: number }; title?: string; subtitle?: React.ReactNode }) {
  const [active, setActive] = useState<RankedPair | null>(null);
  const [drawerIn, setDrawerIn] = useState(false);
  useEffect(() => {
    if (!active) { setDrawerIn(false); return; }
    const id = requestAnimationFrame(() => setDrawerIn(true));
    return () => cancelAnimationFrame(id);
  }, [active]);
  const closeDrawer = () => { setDrawerIn(false); setTimeout(() => setActive(null), 260); };
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeDrawer(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [active]);

  return (
    <div className="card flush">
      <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--color-border)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 800 }}>{title ?? "🏆 ランキング100"} <span className="tag brand">{rows.length}件</span></div>
          <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
            {subtitle ?? <>必須スキル一致率 <b>75%以上</b> を満たすペアを、<b>自動マッチングの総合スコア順</b>で表示（同点は一致スキル数の多い順）。
            対象：案件 {meta.jobsScanned.toLocaleString("ja-JP")} 件 × 人材 {meta.candsScanned.toLocaleString("ja-JP")} 名（適合 {meta.pairsHit.toLocaleString("ja-JP")} ペア）・5分毎に更新。</>}
          </div>
          <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
            行をクリックすると<b>案件×人材を横並びで比較</b>できます。
            総合の下の<b>内訳バー</b>（ス=必須スキル / 単=単価 / 時=稼働時期 / 年=年代 / 勤=勤務形態）でどの次元が満点かを確認できます（<span style={{ color: "#9aa7b4" }}>グレー=情報不明</span>）。
            ボーナスがあるペアは<b style={{ color: "#0095D9" }}>+N</b>を表示します（マージン理想・尚可スキル一致・業界経験 等）。
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--color-ink-4)", fontSize: 13 }}>
          必須スキルが75%以上一致するペアが見つかりませんでした。案件・人材のスキル登録を充実させると候補が増えます。
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12.5, minWidth: 980 }}>
            <thead>
              <tr style={{ color: "var(--color-ink-4)", fontSize: 11, background: "var(--color-surface-soft)" }}>
                <th style={{ padding: "8px 10px", width: 48 }}>順位</th>
                <th style={{ padding: "8px 10px", textAlign: "right", width: 84 }}>総合</th>
                <th style={{ padding: "8px 10px", textAlign: "left", width: 110 }}>必須スキル</th>
                <th style={{ padding: "8px 10px", textAlign: "left" }}>案件</th>
                <th style={{ padding: "8px 10px", textAlign: "left" }}>人材</th>
                <th style={{ padding: "8px 10px", textAlign: "left" }}>一致スキル</th>
                <th style={{ padding: "8px 10px", textAlign: "right", width: 120 }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.job.job_no}-${r.cand.candidate_no}`}
                  onClick={(e) => { if ((e.target as HTMLElement).closest("a,button,input,select,textarea,label")) return; setActive(r); }}
                  title="クリックで案件×人材の詳細を比較"
                  style={{ cursor: "pointer", opacity: r.proposed ? 0.62 : 1, background: r.proposed ? "var(--color-surface-inset)" : undefined }}>
                  <td style={{ padding: "8px 10px", borderTop: "1px solid var(--color-border)", textAlign: "center" }}><RankBadge n={r.rank} /></td>
                  <td style={{ padding: "8px 10px", borderTop: "1px solid var(--color-border)", textAlign: "right" }}>
                    <span className="display tnum" style={{ fontSize: 17, fontWeight: 800, color: r.score >= 80 ? "#067647" : r.score >= 60 ? "#0b5cab" : "#9a5b1a" }}>{r.score}</span><span className="muted" style={{ fontSize: 10 }}>%</span>
                    {/* 内訳ミニバー：スキル/単価/時期/年代/勤務 の5次元の充足を視覚化。
                        グレー=情報不明（不明は満点扱いしないため、100% と表示されている場合でも黒バーは1本足りないことがある）。 */}
                    <DimMiniBar dims={r.dims} bonus={r.bonus} />
                  </td>
                  <td style={{ padding: "8px 10px", borderTop: "1px solid var(--color-border)" }}>
                    <div className="tnum" style={{ fontSize: 13, fontWeight: 800, color: r.skillPct >= 100 ? "#067647" : "#0b5cab" }}>{r.matchedCount}/{r.jobSkillCount}</div>
                    <div className="muted" style={{ fontSize: 10.5 }}>{r.skillPct}% 一致</div>
                  </td>
                  <td style={{ padding: "8px 10px", borderTop: "1px solid var(--color-border)" }}>
                    <div style={{ fontWeight: 700, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <Link href={`/jobs/${r.job.job_no}`} style={{ color: "var(--color-brand-700)", textDecoration: "none" }}>{r.job.title}</Link>
                      <span className="mono muted" style={{ fontSize: 10, fontWeight: 400 }}>No.{String(r.job.job_no).padStart(5, "0")}</span>
                    </div>
                    <div className="muted" style={{ fontSize: 11 }}>{[r.job.client_name, salaryLabel(r.job.salary_min, r.job.salary_max)].filter(Boolean).join(" · ")}</div>
                  </td>
                  <td style={{ padding: "8px 10px", borderTop: "1px solid var(--color-border)" }}>
                    <div style={{ fontWeight: 700, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <Link href={`/people/${r.cand.candidate_no}`} style={{ color: "var(--color-brand-700)", textDecoration: "none" }}>{r.cand.name}</Link>
                      <span className="mono muted" style={{ fontSize: 10, fontWeight: 400 }}>P-{String(r.cand.candidate_no).padStart(5, "0")}</span>
                      {r.proposed && <span style={{ fontSize: 9.5, fontWeight: 700, padding: "1px 6px", borderRadius: 99, background: "#e8ebef", color: "#5b6675", border: "1px solid #d3d9e0" }}>✓ 提案済み</span>}
                    </div>
                    <div className="muted" style={{ fontSize: 11 }}>{[r.cand.title, r.cand.company, r.cand.rate].filter(Boolean).join(" · ")}</div>
                  </td>
                  <td style={{ padding: "8px 10px", borderTop: "1px solid var(--color-border)" }}>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {r.matchedSkills.slice(0, 6).map((s) => <span key={s} className="tag brand" style={{ fontSize: 10 }}>{s}</span>)}
                      {r.matchedSkills.length > 6 && <span className="muted" style={{ fontSize: 10.5, fontWeight: 600 }}>+{r.matchedSkills.length - 6}</span>}
                    </div>
                  </td>
                  <td style={{ padding: "8px 10px", borderTop: "1px solid var(--color-border)", textAlign: "right", whiteSpace: "nowrap" }}>
                    <Link href={`/matching?job=${r.job.job_no}&cand=${r.cand.candidate_no}`} className="btn brand btn-xs" style={{ textDecoration: "none" }}
                      title="このペアでマッチング画面（提案）を開く">→ 提案画面</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {active && <ComparisonDrawer p={active} drawerIn={drawerIn} onClose={closeDrawer} />}
    </div>
  );
}

// ────────────── 比較ドロワー（案件 × 人材 横並び） ──────────────

function ComparisonDrawer({ p, drawerIn, onClose }: { p: RankedPair; drawerIn: boolean; onClose: () => void }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", zIndex: 400, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={(e) => e.stopPropagation()} className="card"
        style={{
          width: "min(1080px, 96vw)", height: "100vh", maxHeight: "100vh", overflowY: "auto",
          borderRadius: 0, padding: 18, display: "flex", flexDirection: "column", gap: 14,
          transform: drawerIn ? "translateX(0)" : "translateX(100%)",
          transition: "transform .26s cubic-bezier(.22,.61,.36,1)",
        }}>
        {/* ヘッダ */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
            <RankBadge n={p.rank} />
            <div>
              <div className="meta" style={{ fontSize: 10, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--color-ink-4)", fontWeight: 600 }}>比較ビュー · 案件 × 人材</div>
              <h3 style={{ margin: "2px 0 0", fontSize: 17, fontWeight: 800 }}>
                <span style={{ color: "#067647" }}>{p.score}%</span> <span className="muted" style={{ fontSize: 12, fontWeight: 500 }}>総合スコア</span>
                <span style={{ marginLeft: 12, color: "#0b5cab" }}>{p.matchedCount}/{p.jobSkillCount}</span> <span className="muted" style={{ fontSize: 12, fontWeight: 500 }}>必須スキル一致（{p.skillPct}%）</span>
              </h3>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Link href={`/matching?job=${p.job.job_no}&cand=${p.cand.candidate_no}`} className="btn brand btn-xs" style={{ textDecoration: "none" }}>→ 提案画面</Link>
            <button className="btn ghost btn-xs" onClick={onClose}>閉じる</button>
          </div>
        </div>

        {/* スキル比較バー */}
        <div className="card" style={{ padding: 12 }}>
          <div style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--color-ink-4)", fontWeight: 600, marginBottom: 6 }}>スキル比較</div>
          <SkillRow label="✅ 一致" tone="green" items={p.matchedSkills} emptyText="一致スキルなし" />
          {p.missingSkills.length > 0 && <SkillRow label="❌ 案件のみ（人材に無い）" tone="red" items={p.missingSkills} />}
          {p.candExtraSkills.length > 0 && <SkillRow label="➕ 人材の追加スキル" tone="gray" items={p.candExtraSkills.slice(0, 30)} more={Math.max(0, p.candExtraSkills.length - 30)} />}
        </div>

        {/* 案件・人材 横並び */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          {/* 案件 */}
          <div className="card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              <div>
                <div className="meta" style={{ fontSize: 10, letterSpacing: ".08em", textTransform: "uppercase", color: "#0b5cab", fontWeight: 700 }}>📋 JOB · 案件</div>
                <div style={{ fontSize: 15, fontWeight: 800, marginTop: 2 }}>
                  <Link href={`/jobs/${p.job.job_no}`} style={{ color: "var(--color-brand-700)", textDecoration: "none" }}>{p.job.title}</Link>{" "}
                  <span className="mono muted" style={{ fontSize: 11, fontWeight: 500 }}>No.{String(p.job.job_no).padStart(5, "0")}</span>
                </div>
              </div>
              <Link href={`/jobs/${p.job.job_no}`} className="btn ghost btn-xs" style={{ textDecoration: "none" }}>案件ページへ</Link>
            </div>
            <RowKV label="クライアント" v={p.job.client_name} />
            <RowKV label="募集職種"     v={p.job.role_label} />
            <RowKV label="単価"         v={salaryLabel(p.job.salary_min, p.job.salary_max)} />
            <RowKV label="リモート"     v={remoteLabel(p.job.remote_type)} />
            <RowKV label="勤務地"       v={p.job.work_location} />
            <RowKV label="開始希望"     v={p.job.start_date} />
            <RowKV label="商流"         v={p.job.flow_note} />
            <RowKV label="必要スキル"   v={
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {(p.job.skills ?? []).map((s) => (
                  <span key={s} className="tag" style={{ fontSize: 10.5, background: p.matchedSkills.includes(s) ? "#e7f7ee" : "#fff1e6", color: p.matchedSkills.includes(s) ? "#067647" : "#9a5b1a", borderColor: "transparent" }}>{p.matchedSkills.includes(s) ? "✓ " : ""}{s}</span>
                ))}
              </div>
            } />
            {p.job.detail && <details style={{ marginTop: 4 }}>
              <summary style={{ fontSize: 11.5, color: "var(--color-ink-3)", cursor: "pointer" }}>案件詳細を表示</summary>
              <div style={{ marginTop: 6, fontSize: 12, color: "var(--color-ink-2)", whiteSpace: "pre-wrap", background: "var(--color-surface-inset)", padding: 10, borderRadius: 8 }}>{p.job.detail}</div>
            </details>}
          </div>

          {/* 人材 */}
          <div className="card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              <div>
                <div className="meta" style={{ fontSize: 10, letterSpacing: ".08em", textTransform: "uppercase", color: "#5b21b6", fontWeight: 700 }}>👤 PERSON · 人材</div>
                <div style={{ fontSize: 15, fontWeight: 800, marginTop: 2 }}>
                  <Link href={`/people/${p.cand.candidate_no}`} style={{ color: "var(--color-brand-700)", textDecoration: "none" }}>{p.cand.name}</Link>{" "}
                  <span className="mono muted" style={{ fontSize: 11, fontWeight: 500 }}>P-{String(p.cand.candidate_no).padStart(5, "0")}</span>
                  {p.proposed && <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 99, background: "#e8ebef", color: "#5b6675", border: "1px solid #d3d9e0" }}>✓ 提案済み</span>}
                </div>
              </div>
              <Link href={`/people/${p.cand.candidate_no}`} className="btn ghost btn-xs" style={{ textDecoration: "none" }}>人材ページへ</Link>
            </div>
            <RowKV label="職種"       v={p.cand.title} />
            <RowKV label="所属"       v={[p.cand.company, p.cand.affiliation].filter(Boolean).join(" · ") || null} />
            <RowKV label="希望単価"   v={p.cand.rate} />
            <RowKV label="リモート希望" v={p.cand.remote_pref} />
            <RowKV label="勤務地"     v={p.cand.location} />
            <RowKV label="経験"       v={p.cand.exp} />
            <RowKV label="稼働開始"   v={p.cand.avail} />
            <RowKV label="年代/国籍"  v={[p.cand.age_band, p.cand.nationality].filter(Boolean).join(" / ") || null} />
            <RowKV label="保有スキル" v={
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {(p.cand.skills ?? []).slice(0, 40).map((s) => (
                  <span key={s} className="tag" style={{ fontSize: 10.5, background: p.matchedSkills.includes(s) ? "#e7f7ee" : "var(--color-surface-inset)", color: p.matchedSkills.includes(s) ? "#067647" : "var(--color-ink-3)", borderColor: "transparent" }}>{p.matchedSkills.includes(s) ? "✓ " : ""}{s}</span>
                ))}
                {(p.cand.skills?.length ?? 0) > 40 && <span className="muted" style={{ fontSize: 10.5, fontWeight: 600 }}>+{p.cand.skills!.length - 40}</span>}
              </div>
            } />
            {p.cand.note && <details style={{ marginTop: 4 }}>
              <summary style={{ fontSize: 11.5, color: "var(--color-ink-3)", cursor: "pointer" }}>備考を表示</summary>
              <div style={{ marginTop: 6, fontSize: 12, color: "var(--color-ink-2)", whiteSpace: "pre-wrap", background: "var(--color-surface-inset)", padding: 10, borderRadius: 8 }}>{p.cand.note}</div>
            </details>}
          </div>
        </div>
      </div>
    </div>
  );
}

function RowKV({ label, v }: { label: string; v: React.ReactNode }) {
  if (v == null || v === "" || (typeof v === "string" && !v.trim())) return null;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "100px 1fr", gap: 10, padding: "6px 0", borderBottom: "1px dashed var(--color-border)", fontSize: 12.5 }}>
      <div className="muted" style={{ fontSize: 11, fontWeight: 600 }}>{label}</div>
      <div style={{ color: "var(--color-ink)", whiteSpace: "pre-wrap" }}>{v}</div>
    </div>
  );
}

function SkillRow({ label, tone, items, more = 0, emptyText }: { label: string; tone: "green" | "red" | "gray"; items: string[]; more?: number; emptyText?: string }) {
  const palette = tone === "green" ? { fg: "#067647", bg: "#e7f7ee" }
                 : tone === "red"   ? { fg: "#b42318", bg: "#fdecef" }
                 :                    { fg: "var(--color-ink-3)", bg: "var(--color-surface-inset)" };
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "6px 0", borderTop: "1px dashed var(--color-border)" }}>
      <div style={{ minWidth: 180, fontSize: 11.5, fontWeight: 700, color: palette.fg }}>{label} <span className="muted" style={{ fontWeight: 500 }}>{items.length}件</span></div>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", flex: 1 }}>
        {items.length === 0 && emptyText ? <span className="muted" style={{ fontSize: 11 }}>{emptyText}</span> : null}
        {items.map((s) => <span key={s} className="tag" style={{ fontSize: 10.5, background: palette.bg, color: palette.fg, borderColor: "transparent" }}>{s}</span>)}
        {more > 0 && <span className="muted" style={{ fontSize: 10.5, fontWeight: 600 }}>+{more}</span>}
      </div>
    </div>
  );
}
