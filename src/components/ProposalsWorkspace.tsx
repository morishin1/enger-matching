"use client";

// 提案管理ワークスペース：期間フィルターを上に1つ持ち、その配下のタブ（ボード/履歴/失注分析）
//   と件数表示がすべて連動して絞り込まれる統合ビュー。
//   - 期間チップ：本日/今週/先週/今月/全期間
//   - 期間で proposals を絞り込み → 進行中/履歴/失注 を再分類してから子に渡す
//   - 既存のProposalStartStats（外部APIで正確COUNT）の機能を内包（クライアント側で配列フィルタ）
//
//   メリット：マネージャー/担当が『今日の提案だけ』『今週の動きだけ』を即時に切り替えられる。

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { ProposalBoardSwitcher } from "./ProposalBoardSwitcher";
import { ProposalHistory } from "./ProposalHistory";
import { LostAnalytics } from "./LostAnalytics";
import { ApprovalQueue } from "./ApprovalQueue";
import { KpiDashboardClient } from "./KpiDashboardClient";
import { TeamActivityBoard } from "./TeamActivityBoard";
import { KpiPeriodBar } from "./KpiPeriodBar";
import { StageTargetBoard } from "./StageTargetBoard";
import { MyDailyScorecard } from "./MyDailyScorecard";
import { ReportsClient } from "./ReportsClient";
import { PeriodChips } from "./PeriodChips";
import { CLIENT_PERIOD_LABEL, CLIENT_PERIOD_KEYS, inClientPeriod, inCustomRange, hasCustomRange, type ClientPeriod } from "@/lib/period";

type Period = ClientPeriod;
const PERIOD_LABEL = CLIENT_PERIOD_LABEL;
const inRangeMs = (t: number, p: Period) => inClientPeriod(t, p);

type TabKey = "kpi" | "approval" | "board" | "history" | "lost" | "report";

/** 承認フォルダ対象：承認待ち（pending）または差戻し（rejected）の提案。 */
function isAwaitingApproval(p: any): boolean {
  const st = String(p?.approval_status ?? "");
  return st === "pending" || st === "rejected" || p?.stage === "承認待ち";
}

export function ProposalsWorkspace({
  proposals, history, analyticsRows, members, proposers, closers, fallbackBanner, currentUserName, privileged, kpiProps, teamActivity, stageTargets, kgiByMember, reportsView,
}: {
  // proposals: 進行中（見送り/失注/稼働を除く）
  proposals: any[];
  // KPI推移タブ用（KpiDashboardClient の props）／メンバー別アクティビティ／日報タブ用。
  kpiProps?: any;
  teamActivity?: any;
  // ステージ別 担当者目標（{owner:{stage:target}}）と メンバー別KGI（稼働化目標）。
  stageTargets?: Record<string, Record<string, number>>;
  kgiByMember?: Record<string, { placementTarget: number | null }>;
  reportsView?: any;
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
  //   ・banner / タブ起動判定は「全期間」を見る（期間外の承認漏れを防ぐため）。
  //   ・承認タブの表示は下の approvalRowsInPeriod で期間連動させる。
  const approvalRows = useMemo(() => proposals.filter(isAwaitingApproval), [proposals]);
  const [period, setPeriod] = useState<Period>("week");
  // 「全期間」チップのカレンダー（任意期間）。from/to 指定時はその範囲で絞り込む。
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  // 既定は「KPI推移」タブ（KPI/KGI→提案→結果→日報 の流れの起点）。
  const [tab, setTab] = useState<TabKey>("kpi");
  // KPI推移タブ内のサブタブ：メンバー別アクティビティ / ステージ目標・達成率。
  const [kpiSubTab, setKpiSubTab] = useState<"activity" | "stage">("activity");

  // KPI推移の期間（KpiPeriodBar が設定する URL の kp / from / to）。メンバー別ステージ目標ボードを
  //   この期間で絞り込むための判定。アクティビティ表はサーバー集計で既に期間連動済み。
  const kpiSp = useSearchParams();
  const kpiKp = kpiSp?.get("kp") || "today"; // 既定は本日（サーバー既定 day と一致）
  const kpiFrom = kpiSp?.get("from") || "";
  const kpiTo = kpiSp?.get("to") || "";
  const inKpiPeriod = (createdAt: string | null | undefined): boolean => {
    if (kpiFrom || kpiTo) return inCustomRange(createdAt, kpiFrom, kpiTo); // 先週/30日/全期間/任意
    const k: ClientPeriod | null = kpiKp === "week" ? "week" : kpiKp === "month" ? "month" : kpiKp === "today" ? "today" : null;
    return k ? inClientPeriod(new Date(createdAt ?? 0).getTime(), k) : true;
  };
  const proposalsForStage = useMemo(() => proposals.filter((p) => inKpiPeriod(p?.created_at)), [proposals, kpiKp, kpiFrom, kpiTo]);

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

  // 期間で created_at を絞り込み。period==="all" のときはカレンダー指定があればその範囲、無ければ全件。
  const inPeriodTime = (t: number): boolean => {
    if (period === "all") return hasCustomRange(customFrom, customTo) ? inCustomRange(t, customFrom, customTo) : true;
    return inRangeMs(t, period);
  };
  const inPeriod = (row: any): boolean => inPeriodTime(new Date(row?.created_at ?? 0).getTime());

  // 承認待ち・差戻しは「承認」タブに集約し、ボードからは除外（重複表示を防ぐ）。
  const boardRows = useMemo(() => proposals.filter((p) => inPeriod(p) && !isAwaitingApproval(p)), [proposals, period, customFrom, customTo]);
  // 承認タブの表示も期間連動（ただし banner/タブ起動は approvalRows=全期間で判定）。
  const approvalRowsInPeriod = useMemo(() => approvalRows.filter(inPeriod), [approvalRows, period, customFrom, customTo]);
  const historyRows = useMemo(() => historyClient.filter(inPeriod), [historyClient, period, customFrom, customTo]);

  // 日報タブ：report_date で期間連動。スコアカード（本日）はそのまま、一覧/カレンダーのみ絞る。
  const reportsViewInPeriod = useMemo(() => {
    const rc = reportsView?.reportsClient;
    if (!rc?.reports) return reportsView;
    const reports = (rc.reports as any[]).filter((r) => inPeriodTime(new Date(r?.report_date ?? 0).getTime()));
    return { ...reportsView, reportsClient: { ...rc, reports } };
  }, [reportsView, period, customFrom, customTo]);

  // メンバー別 KPI達成率（メンバー別アクティビティの 実績合計 ÷ 目標合計）。
  const kpiPctByMember = useMemo(() => {
    const out: Record<string, number | null> = {};
    for (const r of (teamActivity?.rows ?? []) as any[]) {
      const nm = String(r?.name ?? "").trim();
      if (!nm) continue;
      out[nm] = r.targetTotal > 0 ? Math.round((r.total / r.targetTotal) * 100) : null;
    }
    return out;
  }, [teamActivity]);

  // ステージ目標ボードの対象メンバー：提案者 ∪ アクティビティ行の担当者（重複排除）。
  const stageBoardMembers = useMemo(() => {
    const set = new Set<string>();
    for (const nm of proposers ?? []) { const v = String(nm ?? "").trim(); if (v) set.add(v); }
    for (const r of (teamActivity?.rows ?? []) as any[]) { const v = String(r?.name ?? "").trim(); if (v) set.add(v); }
    return Array.from(set);
  }, [proposers, teamActivity]);

  const counts: Record<TabKey, number> = { kpi: 0, approval: approvalRows.length, board: boardRows.length, history: historyRows.length, lost: analyticsClient.length, report: reportsView?.replyUnread ?? 0 };
  // 提案履歴タブは廃止：内容が「提案ボード(進行中) + 失注分析(終了)」と重複し、ブラウザに同じ
  //   行を二重に転送していたため。終了した提案は「失注分析」タブで見られる（mode=analytics）。
  //   ※ コンポーネント(ProposalHistory)は残してあるので、必要なら show: true に戻せば復活可能。
  const tabsDef: { key: TabKey; label: string; icon: string; show: boolean; title?: string }[] = [
    { key: "kpi",      label: "KPI推移",    icon: "insights",    show: true, title: "自分／チームの KPI・KGI 推移。ここを起点に、提案 → 結果（失注分析）→ 改善（日報）の流れで振り返ります。" },
    { key: "approval", label: "承認",       icon: "verified",    show: true, title: "承認待ち・差戻しの提案。承認するとボードへ進みます（期間で絞り込み可。承認漏れ防止のため上部バナーは全期間で判定）。" },
    { key: "board",   label: "提案ボード", icon: "view_kanban", show: true, title: "進行中の提案カンバン。期間フィルタに従って絞り込まれます。" },
    { key: "history", label: "提案履歴",   icon: "history",     show: false, title: "提案履歴。期間フィルタで絞り込み。" },
    // 失注分析タブは件数 0 でも常に表示する（運用上、確認できる場所を固定したいため）。
    { key: "lost",    label: "失注分析",   icon: "monitoring",  show: true, title: "見送り/失注の分析。期間フィルタで絞り込み。0件のときも表示。" },
    { key: "report",  label: "日報",       icon: "edit_note",   show: true, title: "KPI/失注を踏まえた気づき・改善策を日報に記録します。" },
  ];

  // 期間チップに出す件数（ボード進行中 + 取得済みの失注/稼働）。承認タブのときは承認待ち件数。
  const periodOptions = useMemo(() => {
    const countFor = (p: Period) => {
      if (tab === "approval") return approvalRows.filter((r) => inRangeMs(new Date(r?.created_at ?? 0).getTime(), p)).length;
      if (p === "all") return proposals.length + analyticsClient.length;
      const f = (arr: any[]) => arr.filter((r) => inRangeMs(new Date(r?.created_at ?? 0).getTime(), p)).length;
      return f(proposals) + f(analyticsClient);
    };
    return CLIENT_PERIOD_KEYS.map((k) => ({ key: k, label: PERIOD_LABEL[k], count: countFor(k) }));
  }, [tab, proposals, analyticsClient, approvalRows, period, customFrom, customTo]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
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

      {/* タブ＋期間フィルターを1段に揃える（タブを左、期間チップを右）。
          期間フィルターは 提案ボード・失注分析・承認 に作用（統一デザイン）。KPI推移は専用バー、日報は対象外。 */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, borderBottom: "1px solid var(--color-border)", flexWrap: "wrap" }}>
        <div role="tablist" style={{ display: "flex", gap: 2 }}>
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
        {/* 失注分析は専用の集計期間フィルタを持つため、上部の期間チップ対象から除外（二重絞り防止）。 */}
        {(tab === "board" || tab === "approval" || tab === "report") && (
          <div style={{ paddingBottom: 6 }}>
            <PeriodChips value={period} onChange={setPeriod} options={periodOptions}
              calendar={{ calendarKey: "all", from: customFrom, to: customTo,
                onRange: (f, t) => { setPeriod("all"); setCustomFrom(f); setCustomTo(t); } }} />
          </div>
        )}
      </div>

      {/* 子コンポーネントは「開いているタブだけ」描画する（条件付きレンダリング）。
          以前は全タブを display:none で隠しつつ全部レンダリングしていたため、初回に
          履歴(数百件)・失注(数百件)のカードまでサーバーSSR＋ブラウザでハイドレートしており、
          「初回だけ極端に重い／開けば普通」の主因になっていた。見えていないタブは描画しない。 */}
      {tab === "kpi" && (
        kpiProps ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {/* 期間切替は1つに統合（このバーがダッシュボード・各表すべてに連動）。 */}
            <KpiPeriodBar current={kpiProps.period} />
            {/* ① KPIダッシュボードを一番上に（期間タブは内蔵せず上の1バーに統一）。 */}
            <div className="card flush" style={{ overflow: "hidden" }}>
              <KpiDashboardClient {...kpiProps} hidePeriodTabs />
            </div>
            {/* ② メンバー別：アクティビティ と ステージ目標・達成率 をサブタブで分離。 */}
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              <div role="tablist" style={{ display: "flex", gap: 2, borderBottom: "1px solid var(--color-border)", padding: "0 8px", overflowX: "auto" }}>
                {([["activity", `メンバー別アクティビティ（${teamActivity?.periodLabel ?? "本日"}）`], ["stage", "メンバー別 ステージ目標・KPI/KGI達成率"]] as const).map(([k, label]) => {
                  const on = kpiSubTab === k;
                  return (
                    <button key={k} type="button" onClick={() => setKpiSubTab(k)} style={{
                      padding: "10px 14px", background: "transparent", border: 0,
                      borderBottom: on ? "2px solid var(--color-brand-600)" : "2px solid transparent",
                      color: on ? "var(--color-brand-700)" : "var(--color-ink-3)",
                      fontWeight: on ? 700 : 600, fontSize: 13, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
                    }}>{label}</button>
                  );
                })}
              </div>
              <div style={{ padding: 14 }}>
                {kpiSubTab === "activity" ? (
                  teamActivity ? <TeamActivityBoard {...teamActivity} /> : <div className="muted" style={{ fontSize: 12 }}>アクティビティはありません。</div>
                ) : (
                  <>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                      <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 20, color: "var(--color-brand-700)" }}>flag</span>
                      <h3 style={{ margin: 0, fontSize: 13.5, fontWeight: 700 }}>メンバー別 ステージ目標・KPI/KGI達成率</h3>
                      <span className="muted" style={{ fontSize: 11, marginLeft: "auto" }}>所属確認 → 提案中 → 確認中 → 面談 → 合格 の目標/現在/達成率</span>
                    </div>
                    <StageTargetBoard
                      proposals={proposalsForStage}
                      members={stageBoardMembers}
                      stageTargets={stageTargets ?? {}}
                      kgiByMember={kgiByMember ?? {}}
                      kpiPctByMember={kpiPctByMember}
                      canEdit={!!privileged}
                    />
                  </>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="card" style={{ textAlign: "center", color: "var(--color-ink-4)", padding: 40 }}>
            KPI を表示できません（ログイン情報またはDB設定をご確認ください）。
          </div>
        )
      )}
      {tab === "approval" && (
        approvalRows.length > 0 && approvalRowsInPeriod.length === 0 ? (
          <div className="card" style={{ textAlign: "center", color: "var(--color-ink-4)", padding: 40 }}>
            この期間に承認待ち・差戻しはありません（全期間では {approvalRows.length} 件）。
          </div>
        ) : (
          <ApprovalQueue rows={approvalRowsInPeriod} currentUserName={currentUserName} privileged={privileged} />
        )
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
        ) : analyticsClient.length === 0 ? (
          <div className="card" style={{ textAlign: "center", color: "var(--color-ink-4)", padding: 40 }}>
            見送り/失注はまだありません。
          </div>
        ) : (
          // 失注分析は専用の期間フィルタを持つため、上部の期間チップでは二重に絞らず全件を渡す
          //   （①LINE等の集計が過少にならないよう、内側の期間フィルタを唯一の集計期間にする）。
          <LostAnalytics history={analyticsClient} activeRows={proposals} />
        )
      )}
      {tab === "report" && (
        reportsView ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {reportsView.scorecard && <MyDailyScorecard s={reportsView.scorecard} />}
            <ReportsClient {...reportsViewInPeriod.reportsClient} />
          </div>
        ) : (
          <div className="card" style={{ textAlign: "center", color: "var(--color-ink-4)", padding: 40 }}>
            日報を表示できません（ログイン情報をご確認ください）。
          </div>
        )
      )}
    </div>
  );
}
