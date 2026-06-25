"use client";

// 提案管理ワークスペース：期間フィルターを上に1つ持ち、その配下のタブ（ボード/履歴/失注分析）
//   と件数表示がすべて連動して絞り込まれる統合ビュー。
//   - 期間チップ：本日/今週/先週/今月/30日/全期間
//   - 期間で proposals を絞り込み → 進行中/履歴/失注 を再分類してから子に渡す
//   - 既存のProposalStartStats（外部APIで正確COUNT）の機能を内包（クライアント側で配列フィルタ）
//
//   メリット：マネージャー/担当が『今日の提案だけ』『今週の動きだけ』を即時に切り替えられる。

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ProposalBoardSwitcher } from "./ProposalBoardSwitcher";
import { ProposalHistory } from "./ProposalHistory";
import { LostAnalytics } from "./LostAnalytics";
import { ApprovalQueue } from "./ApprovalQueue";

type Period = "today" | "week" | "lastweek" | "month" | "thirty" | "all";

const PERIOD_LABEL: Record<Period, string> = {
  today: "本日", week: "今週", lastweek: "先週", month: "今月", thirty: "30日", all: "全期間",
};

// 今週（月曜起点）の開始時刻。
function thisWeekStart(): number {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  const dow = (d.getDay() + 6) % 7; // 月曜起点
  d.setDate(d.getDate() - dow);
  return d.getTime();
}

function startMs(p: Period): number {
  const now = new Date();
  if (p === "today") { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }
  if (p === "week") return thisWeekStart();
  if (p === "lastweek") return thisWeekStart() - 7 * 86400000; // 先週月曜
  if (p === "month") { const d = new Date(now.getFullYear(), now.getMonth(), 1); return d.getTime(); }
  if (p === "thirty") { return Date.now() - 30 * 86400000; }
  return 0; // all
}

// 期間の終端（この時刻“未満”が対象）。先週のみ「今週月曜」で区切り、他は上限なし。
function endMs(p: Period): number {
  if (p === "lastweek") return thisWeekStart();
  return Number.POSITIVE_INFINITY;
}

// 指定期間に created_at(ms) が入るか。
function inRangeMs(t: number, p: Period): boolean {
  if (p === "all") return true;
  return !!t && t >= startMs(p) && t < endMs(p);
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

  // 履歴・失注は「タブを開いた時」に /api/proposals/list で取得する（遅延ロード）。
  //   従来は親 props で初期描画時にブラウザへ大量転送（履歴326+失注258件＋全列）していたが、
  //   それが egress 急増（5GB/月のうち今日923MB）と /proposals の初期描画遅延の主因だった。
  //   初期表示はボード(進行中)だけにし、履歴/失注タブを開いたタイミングで初めてフェッチする。
  const [historyClient, setHistoryClient] = useState<any[]>(history);
  const [analyticsClient, setAnalyticsClient] = useState<any[]>(analyticsRows);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(history.length > 0);
  const [analyticsLoaded, setAnalyticsLoaded] = useState(analyticsRows.length > 0);
  useEffect(() => {
    if (tab === "history" && !historyLoaded && !historyLoading) {
      setHistoryLoading(true);
      fetch("/api/proposals/list?mode=history").then((r) => r.json()).then((d) => {
        if (d?.ok) setHistoryClient(d.rows ?? []);
        setHistoryLoaded(true);
      }).catch(() => { setHistoryLoaded(true); }).finally(() => setHistoryLoading(false));
    }
    if (tab === "lost" && !analyticsLoaded && !analyticsLoading) {
      setAnalyticsLoading(true);
      fetch("/api/proposals/list?mode=analytics").then((r) => r.json()).then((d) => {
        if (d?.ok) setAnalyticsClient(d.rows ?? []);
        setAnalyticsLoaded(true);
      }).catch(() => { setAnalyticsLoaded(true); }).finally(() => setAnalyticsLoading(false));
    }
  }, [tab, historyLoaded, analyticsLoaded, historyLoading, analyticsLoading]);

  // 期間で created_at を絞り込み（all のときは全件）
  const inPeriod = (row: any): boolean => {
    if (period === "all") return true;
    const t = new Date(row?.created_at ?? 0).getTime();
    return inRangeMs(t, period);
  };

  // 承認待ち・差戻しは「承認」タブに集約し、ボードからは除外（重複表示を防ぐ）。
  const boardRows = useMemo(() => proposals.filter((p) => inPeriod(p) && !isAwaitingApproval(p)), [proposals, period]);
  const historyRows = useMemo(() => historyClient.filter(inPeriod), [historyClient, period]);
  const lostRows = useMemo(() => analyticsClient.filter(inPeriod), [analyticsClient, period]);
  // LINE経由グラフ（失注分析内）の「提案数」算出用に、進行中の提案も期間で絞って渡す。
  const activeInPeriod = useMemo(() => proposals.filter(inPeriod), [proposals, period]);

  const counts: Record<TabKey, number> = { approval: approvalRows.length, board: boardRows.length, history: historyRows.length, lost: lostRows.length };
  // 提案履歴タブは廃止：内容が「提案ボード(進行中) + 失注分析(終了)」と重複し、ブラウザに同じ
  //   行を二重に転送していたため。終了した提案は「失注分析」タブで見られる（mode=analytics）。
  //   ※ コンポーネント(ProposalHistory)は残してあるので、必要なら show: true に戻せば復活可能。
  const tabsDef: { key: TabKey; label: string; icon: string; show: boolean; title?: string }[] = [
    { key: "approval", label: "承認",       icon: "verified",    show: true, title: "承認待ち・差戻しの提案。承認するとボードへ進みます（承認依頼が無くても常に表示・期間フィルタ対象外）。" },
    { key: "board",   label: "提案ボード", icon: "view_kanban", show: true, title: "進行中の提案カンバン。期間フィルタに従って絞り込まれます。" },
    { key: "history", label: "提案履歴",   icon: "history",     show: false, title: "提案履歴。期間フィルタで絞り込み。" },
    // 失注分析タブは件数 0 でも常に表示する（運用上、確認できる場所を固定したいため）。
    { key: "lost",    label: "失注分析",   icon: "monitoring",  show: true, title: "見送り/失注の分析。期間フィルタで絞り込み。0件のときも表示。" },
  ];

  const PeriodChip = ({ p }: { p: Period }) => {
    const active = period === p;
    // 期間カウントはボード（進行中）+ 取得済みの失注/稼働分のみ。失注分析タブを開く前は
    // analyticsClient は空（=未取得）になるが、進行中件数だけ表示される（タブを開けば加算）。
    const n = p === "all" ? proposals.length + analyticsClient.length : (proposals.filter((r) => {
      const t = new Date(r?.created_at ?? 0).getTime(); return inRangeMs(t, p);
    }).length + analyticsClient.filter((r) => {
      const t = new Date(r?.created_at ?? 0).getTime(); return inRangeMs(t, p);
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
        <PeriodChip p="lastweek" />
        <PeriodChip p="month" />
        <PeriodChip p="thirty" />
        <PeriodChip p="all" />
        <span className="muted" style={{ fontSize: 11, marginLeft: "auto" }}>
          選択中：<b style={{ color: "var(--color-ink)" }}>{PERIOD_LABEL[period]}</b> ／
          ボード <b>{boardRows.length}</b>件・履歴 <b>{historyRows.length}</b>件
          {lostRows.length > 0 && <> ・失注 <b>{lostRows.length}</b>件</>}
        </span>
      </div>

      {/* 承認待ちの常時バナー：承認タブ以外を見ているときに承認漏れを防ぐため上部に表示。 */}
      {approvalRows.length > 0 && tab !== "approval" && (
        <button type="button" onClick={() => setTab("approval")}
          style={{
            display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left", cursor: "pointer",
            border: "1px solid #f5b97f", background: "#fff7ed", color: "#9a3412", borderRadius: 10,
            padding: "10px 14px", fontSize: 13, fontWeight: 700, fontFamily: "inherit",
          }}>
          <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 20 }}>notifications_active</span>
          承認待ちが {approvalRows.length} 件あります
          <span style={{ marginLeft: "auto", fontWeight: 700, color: "#b45309" }}>承認タブを開く ›</span>
        </button>
      )}

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

      {/* 子コンポーネントは「開いているタブだけ」描画する（条件付きレンダリング）。
          以前は全タブを display:none で隠しつつ全部レンダリングしていたため、初回に
          履歴(数百件)・失注(数百件)のカードまでサーバーSSR＋ブラウザでハイドレートしており、
          「初回だけ極端に重い／開けば普通」の主因になっていた。見えていないタブは描画しない。 */}
      {tab === "approval" && (
        <ApprovalQueue rows={approvalRows} currentUserName={currentUserName} privileged={privileged} />
      )}
      {tab === "board" && (
        boardRows.length === 0 ? (
          fallbackBanner ?? <div className="card" style={{ textAlign: "center", color: "var(--color-ink-4)", padding: 40 }}>
            この期間に進行中の提案はありません。
          </div>
        ) : (
          <ProposalBoardSwitcher proposals={boardRows} members={members} proposers={proposers} closers={closers} periodLabel={PERIOD_LABEL[period]} />
        )
      )}
      {tab === "history" && (
        historyLoading && !historyLoaded ? (
          <div className="card" style={{ textAlign: "center", color: "var(--color-ink-4)", padding: 40 }}>読み込み中…</div>
        ) : historyRows.length === 0 ? (
          <div className="card" style={{ textAlign: "center", color: "var(--color-ink-4)", padding: 40 }}>
            この期間に提案はありません。
          </div>
        ) : (
          <ProposalHistory items={historyRows} proposers={proposers} closers={closers} />
        )
      )}
      {/* 失注分析タブは件数0でも空状態を表示（タブ自体は隠さない）。 */}
      {tab === "lost" && (
        analyticsLoading && !analyticsLoaded ? (
          <div className="card" style={{ textAlign: "center", color: "var(--color-ink-4)", padding: 40 }}>読み込み中…</div>
        ) : lostRows.length === 0 ? (
          <div className="card" style={{ textAlign: "center", color: "var(--color-ink-4)", padding: 40 }}>
            この期間に見送り/失注はありません。
          </div>
        ) : (
          <LostAnalytics history={lostRows} activeRows={activeInPeriod} />
        )
      )}
    </div>
  );
}
