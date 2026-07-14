"use client";

// ランキング100／おすすめTOP50：定義書の除外条件を満たす案件×人材ペアを総合点数順に表示。
//   行クリックで「案件×人材を横並びで比較」できるドロワーを開く。
//   ・左：案件詳細／右：人材詳細／上部：一致スキル・案件のみ・人材のみのスキル比較。
//   ・ドロワーから「→ 提案画面」「案件ページへ」「人材ページへ」も開ける。
//   ・行のチェックボックスでペアを選択すると、下部フローティングバー（件数＋「提案する」）
//     から一括で提案ボードに記録できる（おすすめTOP50・ランキング100 共通）。

import Link from "@/components/AppLink";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { RankedPair } from "@/lib/ranking100";
import { recordProposal, hidePairs } from "@/lib/actions";
import { MailButton } from "@/components/MailButton";
import { toast } from "@/components/toast";
import { buildJobMailContent, buildCandMailContent, BUTTON_PLACEHOLDER, NOTICE_TEXT } from "@/lib/proposal-mail";
import { jobRemoteLabel, candRemoteLabel } from "@/lib/match";

const salaryLabel = (lo?: number | null, hi?: number | null) =>
  lo && hi ? (lo === hi ? `¥${lo}万` : `¥${lo}〜${hi}万`) : hi ? `〜¥${hi}万` : lo ? `¥${lo}万〜` : "—";
// #376②：案件側リモートは「フルリモート／一部リモート可／出社必須」で表示（match.ts に集約）。
const remoteLabel = (r?: string | null) => jobRemoteLabel(r) || "—";

function RankBadge({ n }: { n: number }) {
  const color = n === 1 ? "#f0a92b" : n === 2 ? "#9aa7b4" : n === 3 ? "#cd853f" : "var(--color-surface-inset)";
  const fg = n <= 3 ? "#fff" : "var(--color-ink-3)";
  return (
    <span style={{ display: "inline-grid", placeItems: "center", width: 28, height: 28, borderRadius: 99, background: color, color: fg, fontSize: 12, fontWeight: 800, fontFamily: "var(--font-display)" }}>{n}</span>
  );
}

// 組み合わせランク（高/中/低）の表示メタ。高=確実 / 中=数点要確認 / 低=要確認多い。
const TIER_META: Record<import("@/lib/ranking100").MatchTier, { label: string; bg: string; fg: string; bd: string }> = {
  high: { label: "高", bg: "#e7f7ee", fg: "#067647", bd: "#bfe3cc" },
  mid:  { label: "中", bg: "#fff4e5", fg: "#9a5b1a", bd: "#f5d9b0" },
  low:  { label: "低", bg: "#eef0f3", fg: "#5b6675", bd: "#dfe3e8" },
};
function TierBadge({ tier, size = "sm" }: { tier: import("@/lib/ranking100").MatchTier; size?: "sm" | "lg" }) {
  const m = TIER_META[tier];
  const big = size === "lg";
  return (
    <span title={`組み合わせランク：${m.label}`} style={{
      display: "inline-grid", placeItems: "center",
      width: big ? 30 : 24, height: big ? 30 : 24, borderRadius: 8,
      background: m.bg, color: m.fg, border: `1px solid ${m.bd}`,
      fontSize: big ? 15 : 12, fontWeight: 800, fontFamily: "var(--font-display)", lineHeight: 1,
    }}>{m.label}</span>
  );
}

const pairKey = (r: RankedPair) => `${r.job.job_no}-${r.cand.candidate_no}`;

export function Ranking100View({ rows, meta, title, subtitle }: { rows: RankedPair[]; meta: { jobsScanned: number; candsScanned: number; pairsHit: number }; title?: string; subtitle?: React.ReactNode }) {
  const router = useRouter();
  const [active, setActive] = useState<RankedPair | null>(null);
  const [drawerIn, setDrawerIn] = useState(false);
  // チェック選択 → 一括「提案する」（提案ボードに記録）。
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<null | { done: number; total: number }>(null);
  const [hiding, setHiding] = useState(false);
  const cancelRef = useRef(false);
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

  const selectedRows = rows.filter((r) => selected.has(pairKey(r)));
  const allChecked = rows.length > 0 && selectedRows.length === rows.length;
  const toggleOne = (r: RankedPair) => setSelected((prev) => {
    const next = new Set(prev); const k = pairKey(r);
    next.has(k) ? next.delete(k) : next.add(k);
    return next;
  });
  const toggleAll = () => setSelected(allChecked ? new Set() : new Set(rows.map(pairKey)));

  // ランク別の件数（高/中/低）。ヘッダの内訳表示に使う。
  const tierCounts = { high: 0, mid: 0, low: 0 } as Record<import("@/lib/ranking100").MatchTier, number>;
  for (const r of rows) tierCounts[r.tier]++;

  // 一括「提案する」：recordProposal（冪等・メールなし・ボードに記録）を選択ペアへ順次実行。
  const doProposeAll = async () => {
    if (selectedRows.length === 0 || busy) return;
    cancelRef.current = false;
    setBusy({ done: 0, total: selectedRows.length });
    let created = 0, existed = 0, failed = 0; let firstError: string | null = null;
    for (let i = 0; i < selectedRows.length; i++) {
      if (cancelRef.current) break;
      const r = selectedRows[i];
      try {
        const res: any = await recordProposal(r.job.job_no, r.cand.candidate_no, r.score);
        if (res?.ok) { res.existed ? existed++ : created++; }
        else { failed++; if (!firstError) firstError = res?.error ?? null; }
      } catch (e) { failed++; if (!firstError) firstError = e instanceof Error ? e.message : String(e); }
      setBusy({ done: i + 1, total: selectedRows.length });
    }
    setBusy(null);
    const parts = [`提案を記録：新規 ${created}件`];
    if (existed) parts.push(`既存 ${existed}件`);
    if (failed) parts.push(`失敗 ${failed}件`);
    toast(parts.join(" / ") + (firstError ? `（${firstError}）` : ""), failed ? "error" : "success");
    if (created > 0) { setSelected(new Set()); router.refresh(); }
  };

  // #345①：選択したペアを「表示させない」（おすすめ/ランキングから恒久除外）。
  const doHideAll = async () => {
    if (selectedRows.length === 0 || hiding || busy) return;
    if (!confirm(`選択した ${selectedRows.length} ペアをランキングに表示しないようにします。\n（期間に関係なく除外され、他の担当にも表示されなくなります）`)) return;
    setHiding(true);
    const res: any = await hidePairs(selectedRows.map((r) => ({ jobNo: r.job.job_no, candNo: r.cand.candidate_no })));
    setHiding(false);
    if (res?.ok) { toast(`${res.hidden} ペアを非表示にしました（ランキングから除外）`, "success"); setSelected(new Set()); router.refresh(); }
    else toast(res?.error || "非表示に失敗しました", "error");
  };

  return (
    <div className="card flush">
      <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--color-border)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 800, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {title ?? "🏆 ランキング100"} <span className="tag brand">{rows.length}件</span>
            {rows.length > 0 && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700 }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><TierBadge tier="high" /> {tierCounts.high}</span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><TierBadge tier="mid" /> {tierCounts.mid}</span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><TierBadge tier="low" /> {tierCounts.low}</span>
              </span>
            )}
          </div>
          <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
            {subtitle ?? <><b>高</b>＝定義書の絶対条件を確定データで全て満たす／<b>中</b>＝1〜2点の要確認あり／<b>低</b>＝要確認3点以上。致命的NG（提案不可・二社下以降・55歳以上・国籍NG・LINE/フリーランス由来・提案済み）は全ランクで除外。各ランク内は<b>総合点数の高い順</b>。
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
          高・中・低いずれのランクでも、致命的NG（提案不可・二社下以降・55歳以上・国籍NG案件×外国籍・LINE/フリーランス由来・提案済み）を除いた有効な組み合わせが見つかりませんでした。
          案件・人材のスキル/単価の登録を充実させると候補が増えます。
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12.5, minWidth: 1030 }}>
            <thead>
              <tr style={{ color: "var(--color-ink-4)", fontSize: 11, background: "var(--color-surface-soft)" }}>
                <th style={{ padding: "8px 10px", width: 36 }}>
                  <input type="checkbox" checked={allChecked} onChange={toggleAll} aria-label="すべて選択"
                    style={{ accentColor: "var(--color-brand-600)", cursor: "pointer" }} />
                </th>
                <th style={{ padding: "8px 10px", width: 48 }}>順位</th>
                <th style={{ padding: "8px 10px", width: 44 }}>ランク</th>
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
                  style={{ cursor: "pointer", opacity: r.proposed ? 0.62 : 1, background: selected.has(pairKey(r)) ? "var(--color-brand-25)" : r.proposed ? "var(--color-surface-inset)" : undefined }}>
                  <td style={{ padding: "8px 10px", borderTop: "1px solid var(--color-border)", textAlign: "center" }}>
                    <input type="checkbox" checked={selected.has(pairKey(r))} onChange={() => toggleOne(r)}
                      aria-label="このペアを選択" style={{ accentColor: "var(--color-brand-600)", cursor: "pointer" }} />
                  </td>
                  <td style={{ padding: "8px 10px", borderTop: "1px solid var(--color-border)", textAlign: "center" }}><RankBadge n={r.rank} /></td>
                  <td style={{ padding: "8px 10px", borderTop: "1px solid var(--color-border)", textAlign: "center" }}><TierBadge tier={r.tier} /></td>
                  <td style={{ padding: "8px 10px", borderTop: "1px solid var(--color-border)", textAlign: "right" }}>
                    {/* 内訳（5次元ミニバー＋ボーナス）は撤去し、総合スコアのみのシンプル表示（要望対応）。 */}
                    <span className="display tnum" style={{ fontSize: 17, fontWeight: 800, color: r.score >= 80 ? "#067647" : r.score >= 60 ? "#0b5cab" : "#9a5b1a" }}>{r.score}</span><span className="muted" style={{ fontSize: 10 }}>%</span>
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
                    {/* #375：勤務形態を追加表示（不明なら出さない）。 */}
                    <div className="muted" style={{ fontSize: 11 }}>{[r.job.client_name, salaryLabel(r.job.salary_min, r.job.salary_max), r.job.remote_type ? remoteLabel(r.job.remote_type) : null].filter(Boolean).join(" · ")}</div>
                  </td>
                  <td style={{ padding: "8px 10px", borderTop: "1px solid var(--color-border)" }}>
                    <div style={{ fontWeight: 700, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <Link href={`/people/${r.cand.candidate_no}`} style={{ color: "var(--color-brand-700)", textDecoration: "none" }}>{r.cand.name}</Link>
                      <span className="mono muted" style={{ fontSize: 10, fontWeight: 400 }}>P-{String(r.cand.candidate_no).padStart(5, "0")}</span>
                      {r.proposed && <span style={{ fontSize: 9.5, fontWeight: 700, padding: "1px 6px", borderRadius: 99, background: "#e8ebef", color: "#5b6675", border: "1px solid #d3d9e0" }}>✓ 提案済み</span>}
                    </div>
                    <div className="muted" style={{ fontSize: 11 }}>{[r.cand.title, r.cand.company, r.cand.rate].filter(Boolean).join(" · ")}</div>
                    {/* #375/#376：年代・居住地・リモート希望を追加表示（リモートは3区分ラベル。空欄は出さない・全部空なら行ごと出さない）。 */}
                    {[r.cand.age_band, r.cand.residence || r.cand.location, candRemoteLabel(r.cand.remote_pref)].some(Boolean) && (
                      <div className="muted" style={{ fontSize: 11 }}>{[r.cand.age_band, r.cand.residence || r.cand.location, candRemoteLabel(r.cand.remote_pref)].filter(Boolean).join(" · ")}</div>
                    )}
                  </td>
                  <td style={{ padding: "8px 10px", borderTop: "1px solid var(--color-border)" }}>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {r.matchedSkills.slice(0, 6).map((s) => <span key={s} className="tag brand" style={{ fontSize: 10 }}>{s}</span>)}
                      {r.matchedSkills.length > 6 && <span className="muted" style={{ fontSize: 10.5, fontWeight: 600 }}>+{r.matchedSkills.length - 6}</span>}
                    </div>
                  </td>
                  <td style={{ padding: "8px 10px", borderTop: "1px solid var(--color-border)", textAlign: "right", whiteSpace: "nowrap" }}>
                    {/* #371：提案画面は別タブで開く（ランキングの閲覧位置を保ったまま提案できるように）。 */}
                    <Link href={`/matching?job=${r.job.job_no}&cand=${r.cand.candidate_no}`} className="btn brand btn-xs" style={{ textDecoration: "none" }}
                      target="_blank" rel="noopener noreferrer"
                      title="このペアでマッチング画面（提案）を別タブで開く">→ 提案画面</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {active && <ComparisonDrawer p={active} drawerIn={drawerIn} onClose={closeDrawer} />}

      {/* 選択中の一括操作バー（画面下部フローティング固定）：件数＋「提案する」のみ。 */}
      {selected.size > 0 && (
        <div className="bulk-bar">
          <span style={{ whiteSpace: "nowrap" }}><b>{selected.size}</b> 件選択中</span>
          {busy && (
            <span style={{ fontSize: 12, opacity: 0.85, whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Spinner /> 提案を記録中… {busy.done}/{busy.total}
            </span>
          )}
          <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
            {busy ? (
              <button type="button" className="btn ghost" onClick={() => { cancelRef.current = true; }}>中止</button>
            ) : (
              <>
                <button type="button" className="btn brand" onClick={doProposeAll}
                  title="選択したペアを提案ボードに一括記録します（メールは送りません。提案済みのペアはスキップ扱い）">
                  <span className="material-symbols-outlined" style={{ fontSize: 16, verticalAlign: "-3px" }}>send</span> 提案する
                </button>
                {/* #345①：選択したペアをランキングから恒久的に非表示にする。 */}
                <button type="button" className="btn ghost" onClick={doHideAll} disabled={hiding}
                  title="選択したペアを今後ランキングに表示しないようにします（期間に関係なく除外・共有）">
                  {hiding
                    ? <><Spinner size={16} /> 非表示にしています…</>
                    : <><span className="material-symbols-outlined" style={{ fontSize: 16, verticalAlign: "-3px" }}>visibility_off</span> このペアは表示させない</>}
                </button>
                <button type="button" className="btn ghost" onClick={() => setSelected(new Set())}>選択解除</button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// 汎用ローディングスピナー（Material Symbols の progress_activity を globals.css の spin で回転）。
function Spinner({ size = 16, color }: { size?: number; color?: string }) {
  return (
    <span className="material-symbols-outlined" aria-hidden
      style={{ fontSize: size, color, verticalAlign: "-3px", animation: "spin .8s linear infinite", display: "inline-block" }}>
      progress_activity
    </span>
  );
}

// ────────────── 比較ドロワー（案件 × 人材 横並び） ──────────────

function ComparisonDrawer({ p, drawerIn, onClose }: { p: RankedPair; drawerIn: boolean; onClose: () => void }) {
  const router = useRouter();
  const [showPreview, setShowPreview] = useState(false);
  const [hiding, setHiding] = useState(false);

  // #371：「提案画面へ」は別タブで開く（ランキング画面に戻る手間をなくす）。
  const goPropose = () => {
    window.open(`/matching?job=${p.job.job_no}&cand=${p.cand.candidate_no}`, "_blank", "noopener,noreferrer");
  };

  // #345①：このペアを「表示させない」（おすすめ/ランキングから恒久除外）。
  const doHide = async () => {
    if (hiding) return;
    if (!confirm("このペアを今後ランキングに表示しないようにします。\n（期間に関係なく除外され、他の担当にも表示されなくなります）")) return;
    setHiding(true);
    const res: any = await hidePairs([{ jobNo: p.job.job_no, candNo: p.cand.candidate_no }]);
    setHiding(false);
    if (res?.ok) { toast("このペアを非表示にしました（ランキングから除外）", "success"); onClose(); router.refresh(); }
    else toast(res?.error || "非表示に失敗しました", "error");
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", zIndex: 400, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={(e) => e.stopPropagation()} className="card"
        style={{
          width: "min(1080px, 96vw)", height: "100vh", maxHeight: "100vh",
          borderRadius: 0, padding: 0, display: "flex", flexDirection: "column",
          transform: drawerIn ? "translateX(0)" : "translateX(100%)",
          transition: "transform .26s cubic-bezier(.22,.61,.36,1)",
        }}>
        {/* スクロール領域：ヘッダ〜案件/人材詳細。下部の提案アクションは常に見えるよう固定フッターに分離。 */}
        <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
        {/* ヘッダ */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
            <RankBadge n={p.rank} />
            <TierBadge tier={p.tier} size="lg" />
            <div>
              <div className="meta" style={{ fontSize: 10, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--color-ink-4)", fontWeight: 600 }}>比較ビュー · 案件 × 人材</div>
              <h3 style={{ margin: "2px 0 0", fontSize: 17, fontWeight: 800 }}>
                <span style={{ color: "#067647" }}>{p.score}%</span> <span className="muted" style={{ fontSize: 12, fontWeight: 500 }}>総合スコア</span>
                <span style={{ marginLeft: 12, color: "#0b5cab" }}>{p.matchedCount}/{p.jobSkillCount}</span> <span className="muted" style={{ fontSize: 12, fontWeight: 500 }}>必須スキル一致（{p.skillPct}%）</span>
              </h3>
            </div>
          </div>
          <button className="btn ghost btn-xs" onClick={onClose}>閉じる</button>
        </div>

        {/* 要確認事項（中・低ランクの根拠）。高ランクは表示しない。 */}
        {p.concerns.length > 0 && (
          <div className="card" style={{ padding: 12, background: p.tier === "low" ? "#f7f8fa" : "#fff9f0", borderColor: p.tier === "low" ? undefined : "#f5d9b0" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--color-ink-3)", marginBottom: 6, display: "inline-flex", alignItems: "center", gap: 6 }}>
              <TierBadge tier={p.tier} /> 提案前に確認したい点（{p.concerns.length}件）
            </div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: "var(--color-ink-2)", lineHeight: 1.7 }}>
              {p.concerns.map((c, i) => <li key={i}>{c}</li>)}
            </ul>
          </div>
        )}

        {/* 送信文プレビュー：一括提案・個別提案いずれも、実際に送るのはこの定型文面。 */}
        {showPreview && <SendTextPreview p={p} />}

        {/* スキル比較バー */}
        <div className="card" style={{ padding: 12 }}>
          <div style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--color-ink-4)", fontWeight: 600, marginBottom: 6 }}>スキル比較</div>
          <SkillRow label="✅ 一致" tone="green" items={p.matchedSkills} emptyText="一致スキルなし" />
          {p.missingSkills.length > 0 && <SkillRow label="❌ 案件のみ（人材に無い）" tone="red" items={p.missingSkills} />}
          {p.candExtraSkills.length > 0 && <SkillRow label="➕ 人材の追加スキル" tone="gray" items={p.candExtraSkills.slice(0, 30)} more={Math.max(0, p.candExtraSkills.length - 30)} />}
        </div>

        {/* 案件・人材 横並び（880px以下は duo-grid で縦積みに切替＝レスポンシブ対応） */}
        <div className="duo-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
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
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                {/* #345③：案件の元メールを開くボタン。 */}
                {p.job.source_mail_url && <MailButton url={p.job.source_mail_url} label="元メール" title="案件の元メールを開く" />}
                <Link href={`/jobs/${p.job.job_no}`} className="btn ghost btn-xs" style={{ textDecoration: "none" }}>案件ページへ</Link>
              </div>
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
            {/* #331/#344 の呼称に統一：案件詳細（detail_note）とメール原文（detail）。 */}
            {p.job.detail_note && <details style={{ marginTop: 4 }} open>
              <summary style={{ fontSize: 11.5, color: "var(--color-ink-3)", cursor: "pointer" }}>案件詳細を表示</summary>
              <div style={{ marginTop: 6, fontSize: 12, color: "var(--color-ink-2)", whiteSpace: "pre-wrap", background: "var(--color-surface-inset)", padding: 10, borderRadius: 8 }}>{p.job.detail_note}</div>
            </details>}
            {p.job.detail && <details style={{ marginTop: 4 }}>
              <summary style={{ fontSize: 11.5, color: "var(--color-ink-3)", cursor: "pointer" }}>メール原文を表示</summary>
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
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                {/* #345③：人材の元メールを開くボタン。 */}
                {p.cand.source_mail_url && <MailButton url={p.cand.source_mail_url} label="元メール" title="人材の元メールを開く" />}
                <Link href={`/people/${p.cand.candidate_no}`} className="btn ghost btn-xs" style={{ textDecoration: "none" }}>人材ページへ</Link>
              </div>
            </div>
            <RowKV label="職種"       v={p.cand.title} />
            <RowKV label="所属"       v={[p.cand.company, p.cand.affiliation].filter(Boolean).join(" · ") || null} />
            <RowKV label="希望単価"   v={p.cand.rate} />
            {/* #376①：リモート希望は「フルリモート希望／一部リモート希望／出社可」で表示。 */}
            <RowKV label="リモート希望" v={candRemoteLabel(p.cand.remote_pref)} />
            {/* #405①：人材側の「勤務地」は最寄り駅を指すため「最寄り駅」に改称。 */}
            <RowKV label="最寄り駅"   v={p.cand.location} />
            {/* #376⑤／#405②：最寄り駅の隣（直下）に居住地を表示。 */}
            <RowKV label="居住地"     v={p.cand.residence} />
            <RowKV label="経験"       v={p.cand.exp} />
            <RowKV label="稼働開始予定日" v={p.cand.avail} />
            <RowKV label="年齢（年代）/国籍" v={[p.cand.age_band, p.cand.nationality].filter(Boolean).join(" / ") || null} />
            <RowKV label="保有スキル" v={
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {(p.cand.skills ?? []).slice(0, 40).map((s) => (
                  <span key={s} className="tag" style={{ fontSize: 10.5, background: p.matchedSkills.includes(s) ? "#e7f7ee" : "var(--color-surface-inset)", color: p.matchedSkills.includes(s) ? "#067647" : "var(--color-ink-3)", borderColor: "transparent" }}>{p.matchedSkills.includes(s) ? "✓ " : ""}{s}</span>
                ))}
                {(p.cand.skills?.length ?? 0) > 40 && <span className="muted" style={{ fontSize: 10.5, fontWeight: 600 }}>+{p.cand.skills!.length - 40}</span>}
              </div>
            } />
            {/* #347：人材詳細（detail_note）とメール原文（旧「備考」＝note）。 */}
            {(p.cand as any).detail_note && <details style={{ marginTop: 4 }} open>
              <summary style={{ fontSize: 11.5, color: "var(--color-ink-3)", cursor: "pointer" }}>人材詳細を表示</summary>
              <div style={{ marginTop: 6, fontSize: 12, color: "var(--color-ink-2)", whiteSpace: "pre-wrap", background: "var(--color-surface-inset)", padding: 10, borderRadius: 8 }}>{(p.cand as any).detail_note}</div>
            </details>}
            {p.cand.note && <details style={{ marginTop: 4 }}>
              <summary style={{ fontSize: 11.5, color: "var(--color-ink-3)", cursor: "pointer" }}>メール原文を表示</summary>
              <div style={{ marginTop: 6, fontSize: 12, color: "var(--color-ink-2)", whiteSpace: "pre-wrap", background: "var(--color-surface-inset)", padding: 10, borderRadius: 8 }}>{p.cand.note}</div>
            </details>}
          </div>
        </div>
        </div>

        {/* 提案アクション：下部固定フッター（要望対応：ボタンは下・常時見える位置に）。
            大きな「提案画面へ」ボタン＋送信文プレビュー。モバイルは縦積み・全幅（r100-drawer-actions）。 */}
        <div className="r100-drawer-actions" style={{ borderTop: "1px solid var(--color-border)", padding: 14, flex: "0 0 auto", background: "var(--color-surface)" }}>
          <button type="button" className="btn brand" onClick={goPropose}
            style={{ fontSize: 15, fontWeight: 800, padding: "12px 26px", borderRadius: 12, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, boxShadow: "0 4px 14px rgba(0,149,217,.28)" }}
            title="このペアの提案画面を別タブで開きます">
            <span className="material-symbols-outlined" style={{ fontSize: 20, verticalAlign: "-4px" }}>send</span> この人材を提案する（提案画面へ）
          </button>
          <button type="button" className="btn ghost" onClick={() => setShowPreview((v) => !v)}
            style={{ fontWeight: 700 }}
            title="実際に送信する提案メールの文面（案件側・人材側）をプレビューします">
            <span className="material-symbols-outlined" style={{ fontSize: 18, verticalAlign: "-4px" }}>{showPreview ? "visibility_off" : "visibility"}</span> {showPreview ? "プレビューを閉じる" : "送信文プレビュー"}
          </button>
          {/* #345①：このペアをランキングから恒久的に非表示にする。 */}
          <button type="button" className="btn ghost" onClick={doHide} disabled={hiding}
            style={{ fontWeight: 700, color: "var(--color-ink-3)" }}
            title="このペアを今後ランキングに表示しないようにします（期間に関係なく除外・共有）">
            {hiding
              ? <><Spinner size={18} /> 非表示にしています…</>
              : <><span className="material-symbols-outlined" style={{ fontSize: 18, verticalAlign: "-4px" }}>visibility_off</span> このペアは表示させない</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// 送信文プレビュー：提案時に実際に送られる定型メール（案件側・人材側）を組み立てて表示。
//   本文テンプレは提案メール送信画面と共通（@/lib/proposal-mail）なので「見たまま」が送られる。
//   応答ボタン部（BUTTON_PLACEHOLDER）は本文中では説明テキストに置換して見せる。
function SendTextPreview({ p }: { p: RankedPair }) {
  const buttonNote = `［メール内に「話を進める／見送り」ボタンが入ります］\n${NOTICE_TEXT}`;
  const jobText = buildJobMailContent(p.job, p.cand).replace(BUTTON_PLACEHOLDER, buttonNote);
  const candText = buildCandMailContent(p.job, p.cand).replace(BUTTON_PLACEHOLDER, buttonNote);
  const Panel = ({ label, dot, text }: { label: string; dot: string; text: string }) => (
    <div className="card" style={{ padding: 12, flex: 1, minWidth: 280, display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontSize: 11, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 6 }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: dot, display: "inline-block" }} />{label}
      </div>
      <div style={{ fontSize: 12, whiteSpace: "pre-wrap", lineHeight: 1.7, color: "var(--color-ink-2)", background: "var(--color-surface-inset)", borderRadius: 8, padding: 10, maxHeight: 320, overflowY: "auto" }}>{text}</div>
    </div>
  );
  return (
    <div className="card" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--color-ink-4)", fontWeight: 600 }}>
        送信文プレビュー（提案時に実際に送られる文面）
      </div>
      <div className="muted" style={{ fontSize: 11 }}>
        ※ 宛先・件名・細部は提案画面で最終確認・編集できます。ここでは本文の見本を表示しています。
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <Panel label="案件側（クライアント宛て）" dot="#ef4444" text={jobText} />
        <Panel label="人材側（所属SES宛て）" dot="#3b82f6" text={candText} />
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
