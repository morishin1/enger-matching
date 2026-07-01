"use client";

// 提案管理のリスト型ビュー（過去に作った見やすい型を再現）。
//   - 上部に ステージ別 KPI カード（クリックで絞り込み）
//   - 人材/案件/クライアントの検索
//   - ステージ・担当者での絞り込み
//   - テーブル（行クリックで詳細モーダル）
// カンバン(ProposalBoard)と同じ proposals データを使う。切替は ProposalBoardSwitcher が担う。
import { Fragment, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/toast";
import { bulkDeleteProposals } from "@/lib/actions";
import { ProposalDetailModal } from "./ProposalDetailModal";
import { NotifyChip } from "./NotifyDot";
import { ActionChips } from "./ProposalActionChip";
import { PROPOSAL_STAGES } from "@/lib/proposal-constants";
import { Icons } from "./icons";

const UNASSIGNED = "__unassigned__"; // 担当者フィルタの「未割当」用の特別値
const STAGES = [...PROPOSAL_STAGES];
// ボード（リスト/カンバン）に表示するステージ。「承認待ち」は専用の「承認」タブに集約したため
//   ボードのKPIカード・絞り込みからは除外する（常に0で紛らわしいのを解消）。
const BOARD_STAGES = STAGES.filter((s) => s !== "承認待ち");
const STAGE_TONE: Record<string, string> = {
  所属確認: "#6b7280", 提案中: "#0095D9", 確認中: "#06b6d4", 面談: "#d98a2b", 合格: "#1aa260",
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
const STAGE_SLA: Record<string, number> = { 所属確認: 2, 提案中: 5, 確認中: 3, 面談: 3, 合格: 7 };
const STAGE_HINT: Record<string, string> = {
  所属確認: "営業可否を確認",
  提案中: "フォロー架電",
  確認中: "先方の意向・条件を確認",
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
  const [q, setQ] = useState("");
  const [stageFilter, setStageFilter] = useState<string>("");
  const [ownerFilter, setOwnerFilter] = useState<string>("");
  const [pendingOnly, setPendingOnly] = useState(false);
  // 同一案件（企業×案件名）に複数人材を提案している行をまとめて表示する（既定ON）。
  //   1社の複数募集に対し同じ案件が重複して並び、コンタクト確認が漏れる問題への対応。
  // まとめ表示モード：案件(job) / 人材(cand) / まとめない(none)。
  const [groupMode, setGroupMode] = useState<"job" | "cand" | "none">("job");
  const [active, setActive] = useState<any | null>(null);
  // 行クリックで開くドロワー(ProposalDetailModal)に詳細・編集・削除を集約（人材/案件一覧と同じ操作感）。
  const router = useRouter();
  const [busy, start] = useTransition();
  // チェックボックス選択（一括削除用）と、同案件アコーディオンの折りたたみ状態。
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleSel = (id: string) => setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const setManySel = (ids: string[], on: boolean) => setSelected((prev) => { const n = new Set(prev); for (const id of ids) on ? n.add(id) : n.delete(id); return n; });
  const toggleCollapse = (k: string) => setCollapsed((prev) => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const isPending = (v: any) => v == null || v === "pending";
  // 管理ID表記：案件=No.xxxxx / 人材=P-xxxxx（マッチングした番号）。
  const idJob = (p: any) => (p.job_no != null ? `No.${String(p.job_no).padStart(5, "0")}` : null);
  const idCand = (p: any) => (p.candidate_no != null ? `P-${String(p.candidate_no).padStart(5, "0")}` : null);

  const handleBulkDelete = () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (!confirm(`選択した ${ids.length} 件の提案を削除しますか？\n（記録ミスの一括取り消し。元に戻せません）`)) return;
    start(async () => {
      const r = await bulkDeleteProposals(ids);
      if (!r.ok) { toast(("error" in r ? r.error : null) || "削除に失敗しました", "error"); return; }
      toast(`${ids.length}件の提案を削除しました`, "success");
      setSelected(new Set());
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
    const m: Record<string, { count: number; due: number; man: number }> = Object.fromEntries(BOARD_STAGES.map((s) => [s, { count: 0, due: 0, man: 0 }]));
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
      .filter((p) => {
        if (!ownerFilter) return true;
        // 「未割当」：提案者 もしくは クロージング担当 が空欄（漏れ防止のため拾う）。
        if (ownerFilter === UNASSIGNED) {
          const noProposer = !String(p.proposer ?? "").trim();
          const cl = String(p.closer ?? p.company_owner ?? "").trim();
          const noCloser = !cl || cl === "未割当";
          return noProposer || noCloser;
        }
        return [p.proposer, p.partner, p.closer, p.company_owner].includes(ownerFilter);
      })
      .filter((p) => !pendingOnly || isPending(p.job_notify_status) || isPending(p.cand_notify_status))
      .filter((p) => {
        if (!needle) return true;
        return [p.candidate_name, p.c_init, p.job_title, p.company, p.client_contact].some((v) => String(v ?? "").toLowerCase().includes(needle));
      })
      .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
  }, [proposals, q, stageFilter, ownerFilter, pendingOnly]);

  // 案件（企業×案件名）または人材（人材NO×イニシャル×氏名）ごとにグルーピング。出現順は維持。
  const groups = useMemo(() => {
    const m = new Map<string, any[]>();
    const order: string[] = [];
    for (const p of rows) {
      const k = groupMode === "cand"
        ? `${String(p.candidate_no ?? "").trim()}|||${String(p.c_init ?? "").trim()}|||${String(p.candidate_name ?? "").trim()}`
        : `${String(p.company ?? "").trim()}|||${String(p.job_title ?? "").trim()}`;
      if (!m.has(k)) { m.set(k, []); order.push(k); }
      m.get(k)!.push(p);
    }
    return order.map((k) => ({ key: k, items: m.get(k)! }));
  }, [rows, groupMode]);

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const someSelected = rows.some((r) => selected.has(r.id));
  const cbStyle = { width: 16, height: 16, flexShrink: 0, cursor: "pointer", accentColor: "var(--color-brand-600)" } as const;

  const proposerTag = (name?: string | null) => {
    const v = String(name ?? "").trim();
    return (
      <span title="提案担当者" style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 99, background: v ? "var(--color-brand-25, #eef5ff)" : "var(--color-surface-inset)", color: v ? "var(--color-brand-700)" : "var(--color-ink-4)", border: "1px solid var(--color-border)", whiteSpace: "nowrap", flexShrink: 0 }}>
        <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 13 }}>person</span>{v || "未割当"}
      </span>
    );
  };

  // クロージング担当者タグ（提案者の隣に表示）。closer が空なら company_owner で代替。
  const closerTag = (p: any) => {
    const v = String(p.closer ?? p.company_owner ?? "").trim();
    if (!v || v === "未割当") return null;
    return (
      <span title="クロージング担当者" style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 99, background: "var(--color-surface-inset)", color: "var(--color-ink-3)", border: "1px solid var(--color-border)", whiteSpace: "nowrap", flexShrink: 0 }}>
        <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 13 }}>handshake</span>{v}
      </span>
    );
  };

  // 通知ステータス：クリックで 未処理→処理中→完了 を循環する操作ボタン（案件側 / 人材側）。
  //   旧実装は静的な色ドットでクリックしても反応しなかったため NotifyChip に置き換える。
  const notifyDots = (p: any) => (
    <span style={{ flex: "0 0 auto", display: "inline-flex", gap: 4, alignItems: "center" }} onClick={(e) => e.stopPropagation()}>
      <NotifyChip status={p.job_notify_status} side="job" proposalId={p.id} />
      <NotifyChip status={p.cand_notify_status} side="cand" proposalId={p.id} />
    </span>
  );

  // 受信側の応答ランプ（話を進める=緑 / 見送り=赤 / 未回答=破線）。
  const actionLamps = (p: any) => (
    <span style={{ flex: "0 0 auto", display: "inline-flex", alignItems: "center" }} title="受信側の応答（左:案件先 / 右:人材先）">
      <ActionChips jobType={p.job_action_type} candType={p.cand_action_type} compact />
    </span>
  );

  // 1提案の行。member=true は同案件グループの配下（人材を主役に表示）。
  const renderRow = (p: any, member: boolean) => {
    const na = nextActionFor(p);
    const naTone = URGENCY_TONE[na.urgency];
    const sel = selected.has(p.id);
    const isLine = p.source === "line";
    return (
      <div key={p.id} style={{ borderBottom: "1px solid var(--color-border)", borderLeft: isLine ? "3px solid #06C755" : "3px solid transparent", background: sel ? "var(--color-brand-25, #eff6ff)" : isLine ? "#eafaf0" : undefined }}>
        <div onClick={() => setActive(p)} title="クリックで詳細・編集ドロワーを開く"
          style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", paddingLeft: member ? 40 : 14, cursor: "pointer" }}
          onMouseEnter={(e) => { if (!sel) e.currentTarget.style.background = "var(--color-surface-soft)"; }}
          onMouseLeave={(e) => { if (!sel) e.currentTarget.style.background = "transparent"; }}>
          <input type="checkbox" checked={sel} onClick={(e) => e.stopPropagation()} onChange={() => toggleSel(p.id)} style={cbStyle} aria-label="選択" />
          {member ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10, flex: "1 1 auto", minWidth: 0 }}>
              <div className="ava" style={{ width: 28, height: 28, fontSize: 10.5, flexShrink: 0 }}>{p.c_init || (p.candidate_name ?? "?").slice(0, 2)}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.candidate_name ?? "—"}</div>
                <div className="muted" style={{ fontSize: 10.5 }}>{idCand(p) ?? ""}{p.lp_direct ? " · 📥LP" : ""}</div>
              </div>
              {proposerTag(p.proposer)}{closerTag(p)}
            </div>
          ) : (
            <>
              <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 5 }}>
                  {p.job_line && <span title="LINE経由の案件" style={{ lineHeight: 0, flexShrink: 0 }}><Icons.line size={15} /></span>}
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.job_title ?? "—"}</span>
                </div>
                <div className="muted" style={{ fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.company ?? ""}{idJob(p) ? ` · ${idJob(p)}` : ""}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "0 0 auto", minWidth: 0, maxWidth: 240 }}>
                <div className="ava" style={{ width: 28, height: 28, fontSize: 10.5, flexShrink: 0 }}>{p.c_init || (p.candidate_name ?? "?").slice(0, 2)}</div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 4 }}>{p.cand_line && <span title="LINE経由の人材" style={{ lineHeight: 0, flexShrink: 0 }}><Icons.line size={14} /></span>}<span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.candidate_name ?? "—"}</span></div>
                  <div className="muted" style={{ fontSize: 10 }}>{idCand(p) ?? ""}{p.lp_direct ? " · 📥LP" : ""}</div>
                </div>
                {proposerTag(p.proposer)}{closerTag(p)}
              </div>
            </>
          )}
          <div style={{ flex: "0 0 auto" }}><StageBadge stage={normStage(p.stage)} /></div>
          <span title={`緊急度: ${na.urgency}`} style={{ flex: "0 0 auto", display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 99, background: naTone.bg, color: naTone.fg, border: `1px solid ${naTone.bd}`, whiteSpace: "nowrap" }}>
            <span className="material-symbols-outlined" style={{ fontSize: 14, lineHeight: 1 }}>{na.icon}</span>
            {na.text}
          </span>
          {actionLamps(p)}
          {notifyDots(p)}
          <span className="muted" style={{ flex: "0 0 auto", fontSize: 11, whiteSpace: "nowrap" }}>{fmtDate(p.created_at)}</span>
        </div>
      </div>
    );
  };

  // 同案件グループの見出し（アコーディオン）。チェックでグループ一括選択、シェブロンで開閉。
  const renderHeader = (g: any) => {
    const top = g.items[0];
    const open = !collapsed.has(g.key);
    const ids = g.items.map((x: any) => x.id);
    const allSel = ids.every((id: string) => selected.has(id));
    const someSel = !allSel && ids.some((id: string) => selected.has(id));
    return (
      <div key={`h-${g.key}`} style={{ background: "var(--color-surface-soft)", borderTop: "2px solid var(--color-border)", borderBottom: "1px solid var(--color-border)", padding: "8px 14px", display: "flex", alignItems: "center", gap: 10 }}>
        <input type="checkbox" checked={allSel} ref={(el) => { if (el) el.indeterminate = someSel; }} onChange={() => setManySel(ids, !allSel)} style={cbStyle} aria-label="この案件の提案をすべて選択" />
        <button type="button" onClick={() => toggleCollapse(g.key)} title={open ? "折りたたむ" : "展開する"} style={{ background: "none", border: 0, cursor: "pointer", padding: 0, display: "inline-flex", alignItems: "center", flexShrink: 0 }}>
          <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 20, color: "var(--color-ink-3)", transform: open ? "rotate(90deg)" : "none", transition: "transform .15s" }}>chevron_right</span>
        </button>
        <div onClick={() => toggleCollapse(g.key)} style={{ flex: "1 1 auto", minWidth: 0, cursor: "pointer", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {(groupMode === "cand" ? top.cand_line : top.job_line) && <span title={groupMode === "cand" ? "LINE経由の人材" : "LINE経由の案件"} style={{ lineHeight: 0, flexShrink: 0 }}><Icons.line size={15} /></span>}
          {groupMode === "cand" ? (
            <>
              {/* 人材ごとにまとめた見出し：人材名（イニシャル）＋人材NO＋提案した案件数。 */}
              <span style={{ fontWeight: 800, color: "var(--color-ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "min(60vw, 520px)" }}>{top.candidate_name ?? top.c_init ?? "—"}</span>
              {top.c_init && top.candidate_name && top.c_init !== top.candidate_name && <span className="muted" style={{ fontSize: 11.5 }}>{top.c_init}</span>}
              {top.candidate_no != null && <span className="mono muted" style={{ fontSize: 10.5 }}>P-{String(top.candidate_no).padStart(5, "0")}</span>}
              <span className="tag brand" style={{ fontSize: 10.5, fontWeight: 700 }}>{g.items.length}件の提案</span>
            </>
          ) : (
            <>
              <span style={{ fontWeight: 800, color: "var(--color-ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "min(60vw, 520px)" }}>{top.job_title ?? "—"}</span>
              {top.company && <span className="muted" style={{ fontSize: 11.5 }}>{top.company}</span>}
              {idJob(top) && <span className="mono muted" style={{ fontSize: 10.5 }}>{idJob(top)}</span>}
              <span className="tag brand" style={{ fontSize: 10.5, fontWeight: 700 }}>{g.items.length}名提案</span>
            </>
          )}
          {!open && <span className="muted" style={{ fontSize: 10.5 }}>（折りたたみ中・クリックで展開）</span>}
        </div>
      </div>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* ステージ別サマリ（クリックで絞り込み）。件数だけでなく
          「要対応(いま動かす件数)」「見込み金額」「次の一手」を出して行動につなげる。 */}
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${BOARD_STAGES.length}, minmax(176px, 1fr))`, gap: 10, overflowX: "auto" }}>
        {BOARD_STAGES.map((s) => {
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
            {BOARD_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--color-ink-3)" }}>
          担当者
          <select value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)} style={{ fontFamily: "inherit", fontSize: 12.5, padding: "7px 9px", borderRadius: 8, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)" }}>
            <option value="">すべて</option>
            <option value={UNASSIGNED}>未割当（提案者/CL空欄）</option>
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
        <button type="button" onClick={() => setGroupMode((v) => (v === "job" ? "none" : "job"))} aria-pressed={groupMode === "job"}
          title="同じ案件（企業×案件名）への提案をまとめて表示"
          style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "inherit", fontSize: 12, fontWeight: 700, padding: "7px 12px", borderRadius: 8,
            border: "1px solid " + (groupMode === "job" ? "var(--color-brand-600)" : "var(--color-border-strong)"),
            background: groupMode === "job" ? "var(--color-brand-600)" : "var(--color-surface)", color: groupMode === "job" ? "#fff" : "var(--color-ink-2)", cursor: "pointer" }}>
          <span className="material-symbols-outlined" style={{ fontSize: 16, lineHeight: 1 }}>splitscreen</span>
          案件ごとにまとめる
        </button>
        <button type="button" onClick={() => setGroupMode((v) => (v === "cand" ? "none" : "cand"))} aria-pressed={groupMode === "cand"}
          title="同じ人材への提案（複数案件）をまとめて表示"
          style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "inherit", fontSize: 12, fontWeight: 700, padding: "7px 12px", borderRadius: 8,
            border: "1px solid " + (groupMode === "cand" ? "var(--color-brand-600)" : "var(--color-border-strong)"),
            background: groupMode === "cand" ? "var(--color-brand-600)" : "var(--color-surface)", color: groupMode === "cand" ? "#fff" : "var(--color-ink-2)", cursor: "pointer" }}>
          <span className="material-symbols-outlined" style={{ fontSize: 16, lineHeight: 1 }}>person</span>
          人材ごとにまとめる
        </button>
      </div>

      {/* 一括操作バー（チェックを入れると表示）。記録ミスの一括取り消し用。 */}
      {selected.size > 0 && (
        <div className="card" style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", border: "1px solid #bcd4ff", background: "var(--color-brand-25, #eff6ff)" }}>
          <span style={{ fontWeight: 800, fontSize: 13 }}>{selected.size}件 選択中</span>
          <button type="button" className="btn ghost btn-xs" onClick={() => setSelected(new Set())}>選択をクリア</button>
          <button type="button" className="btn btn-xs" disabled={busy} onClick={handleBulkDelete}
            style={{ marginLeft: "auto", color: "#fff", background: "var(--color-danger, #dc2626)", border: 0, opacity: busy ? 0.6 : 1 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 15, verticalAlign: "-3px", marginRight: 2 }}>delete</span>
            一括削除（{selected.size}）
          </button>
        </div>
      )}

      {/* リスト：同案件はアコーディオンでまとめ、各行にチェックボックス。行クリックでドロワー。 */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        {rows.length === 0 ? (
          <div style={{ textAlign: "center", color: "var(--color-ink-4)", padding: 36, fontSize: 13 }}>該当する提案がありません。</div>
        ) : (
          <>
            {/* 全選択 */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px", borderBottom: "1px solid var(--color-border)" }}>
              <input type="checkbox" checked={allSelected} ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }} onChange={() => setManySel(rows.map((r) => r.id), !allSelected)} style={cbStyle} aria-label="すべて選択" />
              <span className="muted" style={{ fontSize: 11.5 }}>全{rows.length}件を選択</span>
            </div>
            {groupMode !== "none"
              ? groups.map((g: any) => {
                  const multi = g.items.length >= 2;
                  if (!multi) return renderRow(g.items[0], false);
                  const open = !collapsed.has(g.key);
                  return <Fragment key={g.key}>{renderHeader(g)}{open && g.items.map((p: any) => renderRow(p, true))}</Fragment>;
                })
              : rows.map((p: any) => renderRow(p, false))}
          </>
        )}
      </div>

      <div className="muted" style={{ fontSize: 11.5 }}>{rows.length} 件を表示中{stageFilter || ownerFilter || q ? "（絞り込み適用中）" : ""}</div>

      {active && <ProposalDetailModal p={active} onClose={() => setActive(null)} proposers={proposers} closers={closers} />}
    </div>
  );
}
