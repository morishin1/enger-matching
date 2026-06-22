"use client";

// 提案管理ワークスペース：期間フィルターを上に1つ持ち、その配下のタブ（ボード/履歴/失注分析）
//   と件数表示がすべて連動して絞り込まれる統合ビュー。
//   - 期間チップ：本日/今週/今月/30日/全期間
//   - 期間で proposals を絞り込み → 進行中/履歴/失注 を再分類してから子に渡す
//   - 既存のProposalStartStats（外部APIで正確COUNT）の機能を内包（クライアント側で配列フィルタ）
//
//   メリット：マネージャー/担当が『今日の提案だけ』『今週の動きだけ』を即時に切り替えられる。

import { useMemo, useState, type ReactNode } from "react";
import { ProposalBoardSwitcher } from "./ProposalBoardSwitcher";
import { ProposalHistory } from "./ProposalHistory";
import { LostAnalytics } from "./LostAnalytics";
import { ApprovalQueue } from "./ApprovalQueue";

type Period = "today" | "week" | "month" | "thirty" | "all";

const PERIOD_LABEL: Record<Period, string> = {
  today: "本日", week: "今週", month: "今月", thirty: "30日", all: "全期間",
};

function startMs(p: Period): number {
  const now = new Date();
  if (p === "today") { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }
  if (p === "week") {
    const d = new Date(); d.setHours(0, 0, 0, 0);
    const dow = (d.getDay() + 6) % 7; // 月曜起点
    d.setDate(d.getDate() - dow);
    return d.getTime();
  }
  if (p === "month") { const d = new Date(now.getFullYear(), now.getMonth(), 1); return d.getTime(); }
  if (p === "thirty") { return Date.now() - 30 * 86400000; }
  return 0; // all
}

type TabKey = "approval" | "board" | "history" | "lost";

/** 承認フォルダ対象：承認待ち（pending）または差戻し（rejected）の提案。 */
function isAwaitingApproval(p: any): boolean {
  const st = String(p?.approval_status ?? "");
  return st === "pending" || st === "rejected" || p?.stage === "承認待ち";
}

export function ProposalsWorkspace({
  proposals, history, analyticsRows, members, proposers, closers, fallbackBanner, currentUserName, privileged,
}: {
  // proposals: 進行中（見送り/失注/稼働を除く）
  proposals: any[];
  // history: 全件（進行中＋終了）。期間で絞り込みして ProposalHistory に渡す
  history: any[];
  // analyticsRows: 終了系（見送り/失注/稼働/稼働決定）。LostAnalytics 用
  analyticsRows: any[];
  members?: string[];
  proposers?: string[];
  closers?: string[];
  fallbackBanner?: ReactNode;
  /** ログイン中ユーザー名・承認権限（承認フォルダのボタン出し分け用）。 */
  currentUserName?: string | null;
  privileged?: boolean;
}) {
  // 承認待ちが1件でもあれば最初から「承認」タブを開く（承認漏れを防ぐ）。
  const approvalRows = useMemo(() => proposals.filter(isAwaitingApproval), [proposals]);
  const [period, setPeriod] = useState<Period>("week");
  const [tab, setTab] = useState<TabKey>(approvalRows.length > 0 ? "approval" : "board");

  // 期間で created_at を絞り込み（all のときは全件）
  const inPeriod = (row: any): boolean => {
    if (period === "all") return true;
    const t = new Date(row?.created_at ?? 0).getTime();
    return !!t && t >= startMs(period);
  };

  // 承認待ち・差戻しは「承認」タブに集約し、ボードからは除外（重複表示を防ぐ）。
  const boardRows = useMemo(() => proposals.filter((p) => inPeriod(p) && !isAwaitingApproval(p)), [proposals, period]);
  const historyRows = useMemo(() => history.filter(inPeriod), [history, period]);
  const lostRows = useMemo(() => analyticsRows.filter(inPeriod), [analyticsRows, period]);

  const counts: Record<TabKey, number> = { approval: approvalRows.length, board: boardRows.length, history: historyRows.length, lost: lostRows.length };
  // 期間カウント（提案ボードのカウント数を主にしつつ、全タブの総数も）
  //   ※ 承認タブは「承認漏れ」を防ぐため期間で絞らず全件表示する。
  const tabsDef: { key: TabKey; label: string; icon: string; show: boolean; title?: string }[] = [
    { key: "approval", label: "承認",       icon: "verified",    show: true, title: "承認待ち・差戻しの提案。承認するとボードへ進みます（承認依頼が無くても常に表示・期間フィルタ対象外）。" },
    { key: "board",   label: "提案ボード", icon: "view_kanban", show: true, title: "進行中の提案カンバン。期間フィルタに従って絞り込まれます。" },
    { key: "history", label: "提案履歴",   icon: "history",     show: true, title: "提案履歴。期間フィルタで絞り込み。" },
    // 失注分析タブは件数 0 でも常に表示する（運用上、確認できる場所を固定したいため）。
    { key: "lost",    label: "失注分析",   icon: "monitoring",  show: true, title: "見送り/失注の分析。期間フィルタで絞り込み。0件のときも表示。" },
  ];

  const PeriodChip = ({ p }: { p: Period }) => {
    const active = period === p;
    const n = p === "all" ? proposals.length + analyticsRows.length : (proposals.filter((r) => {
      const t = new Date(r?.created_at ?? 0).getTime(); return !!t && t >= startMs(p);
    }).length + analyticsRows.filter((r) => {
      const t = new Date(r?.created_at ?? 0).getTime(); return !!t && t >= startMs(p);
    }).length);
    return (
      <button type="button" onClick={() => setPeriod(p)}
        style={{
          fontFamily: "inherit", fontSize: 12.5, fontWeight: active ? 800 : 600,
          padding: "6px 14px", borderRadius: 99, cursor: "pointer",
          border: `1px solid ${active ? "var(--color-brand-600)" : "var(--color-border)"}`,
          background: active ? "var(--color-brand-600)" : "#fff",
          color: active ? "#fff" : "var(--color-ink-2)",
        }}>
        {PERIOD_LABEL[p]}<span style={{ marginLeft: 6, opacity: 0.85, fontWeight: 700 }}>{n}</span>
      </button>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* 期間フィルター（上部固定。下の件数・カンバン・履歴・失注すべてに反映） */}
      <div className="card" style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", flexWrap: "wrap" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 800 }}>
          <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 18, color: "var(--color-brand-700)" }}>filter_alt</span>
          期間
        </span>
        <PeriodChip p="today" />
        <PeriodChip p="week" />
        <PeriodChip p="month" />
        <PeriodChip p="thirty" />
        <PeriodChip p="all" />
        <span className="muted" style={{ fontSize: 11, marginLeft: "auto" }}>
          選択中：<b style={{ color: "var(--color-ink)" }}>{PERIOD_LABEL[period]}</b> ／
          ボード <b>{boardRows.length}</b>件・履歴 <b>{historyRows.length}</b>件
          {lostRows.length > 0 && <> ・失注 <b>{lostRows.length}</b>件</>}
        </span>
      </div>

      {/* タブ */}
      <div role="tablist" style={{ display: "flex", gap: 2, borderBottom: "1px solid var(--color-border)" }}>
        {tabsDef.filter((t) => t.show).map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key} type="button" role="tab" aria-selected={active}
              title={t.title} onClick={() => setTab(t.key)}
              style={{
                padding: "10px 18px", background: "transparent", border: 0,
                borderBottom: active ? "2px solid var(--color-brand-600)" : "2px solid transparent",
                color: active ? "var(--color-brand-700)" : "var(--color-ink-3)",
                fontWeight: active ? 700 : 600, fontSize: 13.5, cursor: "pointer", fontFamily: "inherit",
                display: "inline-flex", alignItems: "center", gap: 8, whiteSpace: "nowrap",
              }}>
              <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 18, lineHeight: 1 }}>{t.icon}</span>
              <span>{t.label}</span>
              {counts[t.key] > 0 && <span className="badge" style={{ fontSize: 10, padding: "1px 7px" }}>{counts[t.key]}</span>}
            </button>
          );
        })}
      </div>

      {/* 子コンポーネント。state を保つため display で出し分け。 */}
      <div style={{ display: tab === "approval" ? "block" : "none" }}>
        <ApprovalQueue rows={approvalRows} currentUserName={currentUserName} privileged={privileged} />
      </div>
      <div style={{ display: tab === "board" ? "block" : "none" }}>
        {boardRows.length === 0 ? (
          fallbackBanner ?? <div className="card" style={{ textAlign: "center", color: "var(--color-ink-4)", padding: 40 }}>
            この期間に進行中の提案はありません。
          </div>
        ) : (
          <ProposalBoardSwitcher proposals={boardRows} members={members} proposers={proposers} closers={closers} periodLabel={PERIOD_LABEL[period]} />
        )}
      </div>
      <div style={{ display: tab === "history" ? "block" : "none" }}>
        {historyRows.length === 0 ? (
          <div className="card" style={{ textAlign: "center", color: "var(--color-ink-4)", padding: 40 }}>
            この期間に提案はありません。
          </div>
        ) : (
          <ProposalHistory items={historyRows} proposers={proposers} closers={closers} />
        )}
      </div>
      {/* 失注分析タブは常時表示。期間内に対象が無いときは空状態を出す（タブ自体は隠さない）。 */}
      <div style={{ display: tab === "lost" ? "block" : "none" }}>
        {lostRows.length === 0 ? (
          <div className="card" style={{ textAlign: "center", color: "var(--color-ink-4)", padding: 40 }}>
            この期間に見送り/失注はありません。
          </div>
        ) : (
          <LostAnalytics history={lostRows} />
        )}
      </div>
    </div>
  );
}
