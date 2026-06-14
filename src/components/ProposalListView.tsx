"use client";

// 提案管理のリスト型ビュー（過去に作った見やすい型を再現）。
//   - 上部に ステージ別 KPI カード（クリックで絞り込み）
//   - 人材/案件/クライアントの検索
//   - ステージ・担当者での絞り込み
//   - テーブル（行クリックで詳細モーダル）
// カンバン(ProposalBoard)と同じ proposals データを使う。切替は ProposalBoardSwitcher が担う。
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ProposalDetailModal } from "./ProposalDetailModal";
import { NotifyChip } from "./NotifyDot";
import { ActionChip } from "./ProposalActionChip";
import { deleteProposal } from "@/lib/actions";
import { PROPOSAL_STAGES } from "@/lib/proposal-constants";

const STAGES = [...PROPOSAL_STAGES];
const STAGE_TONE: Record<string, string> = {
  所属確認: "#6b7280", 提案中: "#0095D9", 面談: "#d98a2b", 合格: "#1aa260",
};
const normStage = (s: string | null | undefined) => {
  const v = String(s ?? "").trim();
  if ((STAGES as readonly string[]).includes(v)) return v;
  // 旧→新マッピング（DB に旧値が残っていても綺麗に分類するため）
  if (["提案済", "返信待ち", "提案中", "返信あり"].includes(v)) return "提案中";
  if (["面談調整", "クロージング中"].includes(v)) return "面談";
  if (v === "面談合格") return "合格";
  return "提案中";
};
const fmtDate = (d: any) => { if (!d) return "—"; const t = new Date(d); return isNaN(t.getTime()) ? "—" : `${t.getFullYear()}/${String(t.getMonth() + 1).padStart(2, "0")}/${String(t.getDate()).padStart(2, "0")}`; };
const fmtDateTime = (d: any) => {
  if (!d) return "—";
  const t = new Date(d);
  if (isNaN(t.getTime())) return "—";
  return `${t.getFullYear()}/${String(t.getMonth() + 1).padStart(2, "0")}/${String(t.getDate()).padStart(2, "0")} ${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
};
const daysAgo = (d: any) => {
  if (!d) return 0;
  const t = new Date(d).getTime();
  if (isNaN(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
};

// 単価文字列（"¥70万" "70" 等）→ 万円の数値。見込み金額の集計に使う。
const parseManYen = (rate?: string | number | null): number => {
  if (rate == null) return 0;
  if (typeof rate === "number") return rate >= 10000 ? Math.round(rate / 10000) : Math.round(rate);
  const m = String(rate).replace(/,/g, "").match(/(\d+(?:\.\d+)?)/);
  if (!m) return 0;
  let n = parseFloat(m[1]);
  if (/万/.test(rate)) return Math.round(n);
  if (n >= 10000) n = n / 10000;
  return Math.round(n);
};
const yen = (man: number) => (man >= 10000 ? `${(man / 10000).toFixed(1)}億` : `${man.toLocaleString("ja-JP")}万`);

// ステージごとの目標滞留日数(SLA)と、滞留したとき何をすべきか（行動を促す一手）。
const STAGE_SLA: Record<string, number> = { 所属確認: 2, 提案中: 5, 面談: 3, 合格: 7 };
const STAGE_HINT: Record<string, string> = {
  所属確認: "営業可否を確認",
  提案中: "フォロー架電",
  面談: "日程を確定・実施",
  合格: "稼働化する",
};

// 安定カラー（同じ名前は同じ色）— 提案者・CLの見分け用
const PALETTE = ["#0b5cab", "#7c3aed", "#1aa260", "#d97706", "#dc2626", "#0891b2", "#db2777", "#65a30d", "#475569", "#ea580c", "#4338ca", "#0d9488"];
function hashColor(name?: string | null): string {
  if (!name) return "#9aa7b4";
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

// ネクストアクション判定。ステージ × 通知ステータス × 滞留日数から「今何をすべきか」を返す。
type NextAction = { text: string; urgency: "high" | "medium" | "low" | "ok"; icon: string };
function nextActionFor(p: any): NextAction {
  const stage = normStage(p.stage);
  const jobPending = !p.job_notify_status || p.job_notify_status === "pending";
  const candPending = !p.cand_notify_status || p.cand_notify_status === "pending";
  const stageDays = daysAgo(p.stage_updated_at || p.updated_at || p.created_at);
  const caller = p.caller_status || "";

  if (stage === "合格") return { text: "稼働化へ（契約・条件確認）", urgency: "high", icon: "rocket_launch" };

  if (stage === "面談") {
    if (p.meeting_date && p.meeting_status !== "実施済") return { text: `面談 ${String(p.meeting_date).slice(5)} 当日対応`, urgency: "medium", icon: "event_available" };
    return { text: "面談日程の確定・実施", urgency: "high", icon: "event" };
  }

  if (stage === "所属確認") {
    if (stageDays >= 2) return { text: `在否確認の催促（${stageDays}日滞留）`, urgency: "high", icon: "contact_phone" };
    return { text: "案件先・人材先に営業可否を確認", urgency: "medium", icon: "contact_phone" };
  }

  // 提案中（提案を実施し反応待ち）
  if (caller === "未架電" || !caller) {
    if (jobPending && candPending) return { text: "案件・人材へ初回コンタクト", urgency: "high", icon: "call" };
    if (jobPending) return { text: "クライアントへ確認連絡", urgency: "medium", icon: "business" };
    if (candPending) return { text: "候補者へ意思確認", urgency: "medium", icon: "person" };
  }
  if (jobPending) return { text: "クライアントへフォロー", urgency: "medium", icon: "business" };
  if (candPending) return { text: "候補者へフォロー", urgency: "medium", icon: "person" };
  if (stageDays >= 5) return { text: `フォロー必須（${stageDays}日滞留）`, urgency: "high", icon: "priority_high" };
  return { text: "フォロー検討", urgency: "low", icon: "schedule" };
}

const URGENCY_TONE: Record<NextAction["urgency"], { fg: string; bg: string; bd: string }> = {
  high:   { fg: "#b42318", bg: "#fdecef", bd: "#f7c5cf" },
  medium: { fg: "#b45309", bg: "#fff6e0", bd: "#fde9b0" },
  low:    { fg: "#0b5cab", bg: "#eaf4fd", bd: "#bfd9f5" },
  ok:     { fg: "#067647", bg: "#e7f7ee", bd: "#bfe3cc" },
};

function PersonTag({ role, name }: { role: "P" | "CL"; name?: string | null }) {
  const v = name?.trim();
  if (!v) return <span className="muted" style={{ fontSize: 10.5 }}>{role === "P" ? "提案 未割当" : "CL 未割当"}</span>;
  const col = hashColor(v);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10.5, fontWeight: 700, padding: "1px 8px", borderRadius: 99, background: `${col}1a`, color: col, border: `1px solid ${col}55`, whiteSpace: "nowrap" }}>
      <span style={{ fontSize: 9, opacity: 0.75 }}>{role}</span>{v}
    </span>
  );
}

function StageBadge({ stage }: { stage: string }) {
  const tone = STAGE_TONE[stage] ?? "#6b7280";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 99, background: `${tone}14`, color: tone }}>
      <span style={{ width: 6, height: 6, borderRadius: 99, background: tone }} />{stage}
    </span>
  );
}

// 受信者の応答チップ（話を進める=緑 / 見送り=赤 / 未回答=破線）は共通コンポーネントに集約。
//   カンバン表示と見た目を揃えるため ProposalActionChip から import する。

export function ProposalListView({ proposals, proposers, closers }: { proposals: any[]; members?: string[]; proposers?: string[]; closers?: string[] }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [stageFilter, setStageFilter] = useState<string>("");
  const [ownerFilter, setOwnerFilter] = useState<string>("");
  const [pendingOnly, setPendingOnly] = useState(false);
  const [active, setActive] = useState<any | null>(null);
  const isPending = (v: any) => v == null || v === "pending";

  const handleDelete = (p: any) => {
    if (!confirm(`「${p.candidate_name ?? "—"} × ${p.job_title ?? "—"}」の提案を削除しますか？\n（記録ミスの取り消し。元に戻せません）`)) return;
    setBusyId(p.id);
    start(async () => {
      const r = await deleteProposal(p.id);
      setBusyId(null);
      if (!r.ok) { alert(("error" in r ? r.error : null) || "削除に失敗しました"); return; }
      router.refresh();
    });
  };
  const pendingCount = useMemo(() => proposals.filter((p) => isPending(p.job_notify_status) || isPending(p.cand_notify_status)).length, [proposals]);

  // ステージ別サマリ（件数 + 要対応(滞留/未処理) + 見込み金額）。
  //   要対応 = そのステージで「いま動かすべき」件数：
  //     ・通知が未処理（案件側 or 人材側が pending） … 初回コンタクト/フォロー漏れ
  //     ・SLA超過（stage_updated_at から STAGE_SLA 日以上動きなし） … 放置
  //   見込み金額 = そのステージにある提案の単価合計（万円）。どこに売上が積まれているか。
  const stats = useMemo(() => {
    const m: Record<string, { count: number; due: number; man: number }> = Object.fromEntries(STAGES.map((s) => [s, { count: 0, due: 0, man: 0 }]));
    for (const p of proposals) {
      const s = normStage(p.stage);
      const e = m[s]; if (!e) continue;
      e.count++;
      e.man += parseManYen(p.rate);
      const stalled = daysAgo(p.stage_updated_at || p.updated_at || p.created_at) >= (STAGE_SLA[s] ?? 5);
      const pending = isPending(p.job_notify_status) || isPending(p.cand_notify_status);
      if (stalled || pending) e.due++;
    }
    return m;
  }, [proposals]);

  // 担当者の選択肢（提案者・パートナー・クロージングをまとめて）
  const owners = useMemo(() => {
    const set = new Set<string>();
    for (const p of proposals) { for (const k of [p.proposer, p.partner, p.closer, p.company_owner]) if (k) set.add(k); }
    return [...set].sort();
  }, [proposals]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return proposals
      .filter((p) => !stageFilter || normStage(p.stage) === stageFilter)
      .filter((p) => !ownerFilter || [p.proposer, p.partner, p.closer, p.company_owner].includes(ownerFilter))
      .filter((p) => !pendingOnly || isPending(p.job_notify_status) || isPending(p.cand_notify_status))
      .filter((p) => {
        if (!needle) return true;
        return [p.candidate_name, p.c_init, p.job_title, p.company, p.client_contact].some((v) => String(v ?? "").toLowerCase().includes(needle));
      })
      .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
  }, [proposals, q, stageFilter, ownerFilter, pendingOnly]);

  const th: React.CSSProperties = { textAlign: "left", padding: "10px 12px", fontSize: 11, color: "var(--color-ink-4)", fontWeight: 600, whiteSpace: "nowrap" };
  const td: React.CSSProperties = { padding: "10px 12px", fontSize: 12.5, verticalAlign: "middle" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* ステージ別サマリ（クリックで絞り込み）。件数だけでなく
          「要対応(いま動かす件数)」「見込み金額」「次の一手」を出して行動につなげる。 */}
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${STAGES.length}, minmax(176px, 1fr))`, gap: 10, overflowX: "auto" }}>
        {STAGES.map((s) => {
          const tone = STAGE_TONE[s] ?? "#6b7280";
          const on = stageFilter === s;
          const st = stats[s] ?? { count: 0, due: 0, man: 0 };
          return (
            <button key={s} type="button" onClick={() => setStageFilter(on ? "" : s)} title={on ? "絞り込み解除" : `「${s}」で絞り込み`}
              className="card" style={{ textAlign: "left", padding: 14, cursor: "pointer", border: on ? `2px solid ${tone}` : "1px solid var(--color-border)", background: on ? `${tone}0d` : "var(--color-surface)", fontFamily: "inherit", display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 700, color: tone }}>
                  <span style={{ width: 8, height: 8, borderRadius: 99, background: tone }} />{s}
                </span>
                {st.man > 0 && <span className="mono" style={{ fontSize: 11, color: "var(--color-ink-3)" }}>¥{yen(st.man)}</span>}
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                <span className="tnum" style={{ fontSize: 24, fontWeight: 800, lineHeight: 1 }}>{st.count}</span>
                <span className="muted" style={{ fontSize: 11 }}>件</span>
              </div>
              {/* 要対応（滞留 or 未処理）＝今すぐ動かす件数＋次の一手 */}
              {st.due > 0 ? (
                <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, color: "#b42318" }}>
                  <span style={{ width: 7, height: 7, borderRadius: 99, background: "#dc2626" }} />
                  要対応 {st.due}
                  <span style={{ fontWeight: 600, color: "var(--color-ink-3)" }}>→ {STAGE_HINT[s] ?? ""}</span>
                </div>
              ) : (
                <div style={{ fontSize: 11, color: st.count > 0 ? "#067647" : "var(--color-ink-4)", fontWeight: 600 }}>
                  {st.count > 0 ? "✓ 滞留なし" : "—"}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* 検索 + フィルタ */}
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: "1 1 320px", minWidth: 240 }}>
          <span className="material-symbols-outlined" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontSize: 18, color: "var(--color-ink-4)" }}>search</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="人材名・案件名・クライアントで検索…"
            style={{ width: "100%", fontFamily: "inherit", fontSize: 13, padding: "10px 12px 10px 38px", borderRadius: 10, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)" }} />
        </div>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--color-ink-3)" }}>
          ステータス
          <select value={stageFilter} onChange={(e) => setStageFilter(e.target.value)} style={{ fontFamily: "inherit", fontSize: 12.5, padding: "7px 9px", borderRadius: 8, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)" }}>
            <option value="">すべて</option>
            {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--color-ink-3)" }}>
          担当者
          <select value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)} style={{ fontFamily: "inherit", fontSize: 12.5, padding: "7px 9px", borderRadius: 8, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)" }}>
            <option value="">すべて</option>
            {owners.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
        <button type="button" onClick={() => setPendingOnly((v) => !v)} aria-pressed={pendingOnly}
          title="未処理（赤ドット）の提案だけを表示"
          style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "inherit", fontSize: 12, fontWeight: 700, padding: "7px 12px", borderRadius: 8,
            border: "1px solid " + (pendingOnly ? "#dc2626" : "var(--color-border-strong)"),
            background: pendingOnly ? "#dc2626" : "var(--color-surface)", color: pendingOnly ? "#fff" : "var(--color-ink-2)", cursor: "pointer" }}>
          <span style={{ width: 8, height: 8, borderRadius: 99, background: pendingOnly ? "#fff" : "#dc2626" }} />
          未処理のみ <span style={{ opacity: 0.85 }}>({pendingCount})</span>
        </button>
      </div>

      {/* テーブル */}
      <div className="card" style={{ padding: 0, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
              <th style={th}>提案日時</th>
              <th style={th}>人材</th>
              <th style={th}>案件</th>
              <th style={th}>提案者 / CL</th>
              <th style={th}>更新日</th>
              <th style={th}>ステータス</th>
              <th style={th}>ネクストアクション</th>
              <th style={th}>通知</th>
              <th style={{ ...th, textAlign: "center" }}>詳細</th>
              <th style={{ ...th, textAlign: "center" }}>削除</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={10} style={{ ...td, textAlign: "center", color: "var(--color-ink-4)", padding: 36 }}>該当する提案がありません。</td></tr>
            )}
            {rows.map((p) => {
              const na = nextActionFor(p);
              const naTone = URGENCY_TONE[na.urgency];
              const closerName = p.closer ?? p.company_owner;
              return (
              <tr key={p.id} onClick={() => setActive(p)} style={{ borderBottom: "1px solid var(--color-border)", cursor: "pointer", opacity: busyId === p.id ? 0.5 : 1 }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-surface-soft)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                <td style={{ ...td, whiteSpace: "nowrap", color: "var(--color-ink-3)" }}>{fmtDateTime(p.created_at)}</td>
                <td style={td}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div className="ava" style={{ width: 30, height: 30, fontSize: 11, flexShrink: 0 }}>{p.c_init || (p.candidate_name ?? "?").slice(0, 2)}</div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 180 }}>{p.candidate_name ?? "—"}</div>
                    </div>
                  </div>
                </td>
                <td style={td}>
                  <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 320 }}>{p.job_title ?? "—"}</div>
                  <div className="muted" style={{ fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 320 }}>{p.company ?? ""}</div>
                </td>
                <td style={td}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 3, alignItems: "flex-start" }}>
                    <PersonTag role="P" name={p.proposer} />
                    <PersonTag role="CL" name={closerName === "未割当" ? null : closerName} />
                  </div>
                </td>
                <td style={{ ...td, whiteSpace: "nowrap", color: "var(--color-ink-3)" }}>{fmtDate(p.updated_at ?? p.stage_updated_at ?? p.created_at)}</td>
                <td style={td}>
                  <StageBadge stage={normStage(p.stage)} />
                  {/* 失注/見送りなら理由をその場に表示（前まで見えていた失注理由を復活） */}
                  {(p.stage === "見送り" || p.stage === "失注") && p.lost_reason && (
                    <div style={{ marginTop: 4, fontSize: 10.5, color: "#b42318" }} title={p.lost_reason_note ?? undefined}>
                      💔 {p.lost_reason}{p.lost_phase ? `（${p.lost_phase}）` : ""}
                    </div>
                  )}
                </td>
                <td style={td}>
                  <span title={`緊急度: ${na.urgency}`} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 99, background: naTone.bg, color: naTone.fg, border: `1px solid ${naTone.bd}`, whiteSpace: "nowrap" }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 14, lineHeight: 1 }}>{na.icon}</span>
                    {na.text}
                  </span>
                </td>
                <td style={td}>
                  <div style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}>
                    {/* 受信側の応答ステータス（PR #130 で導入された action_type 列を使用） */}
                    <div style={{ display: "inline-flex", gap: 4 }}>
                      <ActionChip type={p.job_action_type}  side="job"  />
                      <ActionChip type={p.cand_action_type} side="cand" />
                    </div>
                    {/* 営業側のフォロー進捗（通知ステータス〇） */}
                    <div style={{ display: "inline-flex", gap: 4 }}>
                      <NotifyChip status={p.job_notify_status}  side="job"  proposalId={p.id} />
                      <NotifyChip status={p.cand_notify_status} side="cand" proposalId={p.id} />
                    </div>
                  </div>
                </td>
                <td style={{ ...td, textAlign: "center" }}>
                  <button type="button" onClick={(e) => { e.stopPropagation(); setActive(p); }} className="btn ghost btn-xs" aria-label="詳細を開く" title="詳細を開く">
                    <span className="material-symbols-outlined" style={{ fontSize: 16, color: "var(--color-brand-700)" }}>mail</span>
                  </button>
                </td>
                <td style={{ ...td, textAlign: "center" }}>
                  <button type="button" onClick={(e) => { e.stopPropagation(); handleDelete(p); }} className="btn ghost btn-xs" aria-label="提案を削除" title="提案を削除（元に戻せません）" disabled={busy && busyId === p.id}>
                    <span className="material-symbols-outlined" style={{ fontSize: 16, color: "var(--color-danger)" }}>delete</span>
                  </button>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="muted" style={{ fontSize: 11.5 }}>{rows.length} 件を表示中{stageFilter || ownerFilter || q ? "（絞り込み適用中）" : ""}</div>

      {active && <ProposalDetailModal p={active} onClose={() => setActive(null)} proposers={proposers} closers={closers} />}
    </div>
  );
}
