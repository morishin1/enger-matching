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
import { TeamActivityBoard, TargetEditModal } from "./TeamActivityBoard";
import { KpiPeriodBar } from "./KpiPeriodBar";
import { KgiFunnelBanner } from "./KgiFunnelBanner";
import { StageTargetBoard } from "./StageTargetBoard";
import { KpiMembersEditor } from "./KpiMembersEditor";
import type { KpiMember } from "@/lib/kpi-members";
import { MyDailyScorecard } from "./MyDailyScorecard";
import { ReportsClient } from "./ReportsClient";
import { PeriodChips } from "./PeriodChips";
import { CLIENT_PERIOD_LABEL, CLIENT_PERIOD_KEYS, inClientPeriod, inCustomRange, hasCustomRange, type ClientPeriod } from "@/lib/period";
import { ownerMatches } from "@/lib/owner-match";
import { normalizeStage } from "@/lib/proposal-constants";

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
  proposals, history, analyticsRows, members, proposers, closers, fallbackBanner, currentUserName, privileged, kpiProps, teamActivity, teamFunnel, stageTargets, kgiByMember, roleByMember, kpiMembers, kpiMemberSuggestions, funnelRates, meetingEvents, procurementEvents, meetingReachedEvents, proposalReachedEvents, reportsView,
}: {
  // proposals: 進行中（見送り/失注/稼働を除く）
  proposals: any[];
  // KPI推移タブ用（KpiDashboardClient の props）／メンバー別アクティビティ／日報タブ用。
  kpiProps?: any;
  teamActivity?: any;
  teamFunnel?: any;
  // ステージ別 担当者目標（{owner:{stage:target}}）と メンバー別KGI（稼働化目標）。
  stageTargets?: Record<string, Record<string, number>>;
  kgiByMember?: Record<string, { placementTarget: number | null }>;
  // 役割別KPI/KGI：メンバー名→役割（outside/inside/telapo）と、チームのファネル目標（面談率/合格率）。
  roleByMember?: Record<string, string>;
  // KPI推移のメンバーマスタ（編集UI＋ステージ目標ボードの対象メンバー）。
  kpiMembers?: KpiMember[];
  kpiMemberSuggestions?: string[];
  funnelRates?: { meetingRate: number; passRate: number; won: number };
  // ステージ目標ボード「打ち合わせ／案件の仕入れ／面談」列のソースイベント（{date, owner} の compact 配列）。
  meetingEvents?: { date: string; owner: string }[];
  procurementEvents?: { date: string; owner: string }[];
  meetingReachedEvents?: { date: string; owner: string }[];
  proposalReachedEvents?: { date: string; owner: string }[];   // #234②「提案中」列の累計ソース
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
  const [stageTeamEdit, setStageTeamEdit] = useState(false); // #234①：ステージ目標タブ内の「チーム目標を編集（週次）」

  // KPI推移の期間（KpiPeriodBar が設定する URL の kp / from / to）。メンバー別ステージ目標ボードを
  //   この期間で絞り込むための判定。アクティビティ表はサーバー集計で既に期間連動済み。
  const kpiSp = useSearchParams();
  const kpiKp = kpiSp?.get("kp") || "today"; // 既定は本日（サーバー既定 day と一致）
  const kpiFrom = kpiSp?.get("from") || "";
  const kpiTo = kpiSp?.get("to") || "";
  const inKpiPeriod = (createdAt: string | null | undefined): boolean => {
    if (kpiFrom || kpiTo) return inCustomRange(createdAt, kpiFrom, kpiTo); // 先週/期間指定（from/to あり）
    const t = new Date(createdAt ?? 0).getTime();
    if (!t) return false;
    if (kpiKp === "yesterday") {
      const s = new Date(); s.setHours(0, 0, 0, 0); const sm = s.getTime();
      return t >= sm - 86400000 && t < sm;
    }
    if (kpiKp === "quarter") {
      // サーバーの quarter（暦の四半期）と揃える：その四半期の開始〜+3ヶ月。
      const d = new Date(); const qm = Math.floor(d.getMonth() / 3) * 3;
      return t >= new Date(d.getFullYear(), qm, 1).getTime() && t < new Date(d.getFullYear(), qm + 3, 1).getTime();
    }
    const k: ClientPeriod | null = kpiKp === "week" ? "week" : kpiKp === "month" ? "month" : kpiKp === "today" ? "today" : null;
    return k ? inClientPeriod(t, k) : true;
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
  //   打ち合わせ/案件の仕入れだけ実績があるメンバーも表示できるよう、提案者リストの名前に
  //   寄せられないイベント担当者も補完する（既存メンバーに一致しないowner名はそのまま追加）。
  const stageBoardMembers = useMemo(() => {
    const set = new Set<string>();
    for (const nm of proposers ?? []) { const v = String(nm ?? "").trim(); if (v) set.add(v); }
    for (const nm of closers ?? []) { const v = String(nm ?? "").trim(); if (v) set.add(v); } // 合格（稼働決定）はクロージング担当で集計するため
    for (const r of (teamActivity?.rows ?? []) as any[]) { const v = String(r?.name ?? "").trim(); if (v) set.add(v); }
    // KPI推移のメンバーマスタ（手動登録）は、提案/活動が無くても必ず行として表示する。
    for (const m of kpiMembers ?? []) { const v = String(m?.name ?? "").trim(); if (v) set.add(v); }
    const base = Array.from(set);
    const addOwner = (raw: string) => {
      const v = String(raw ?? "").trim(); if (!v) return;
      if (!base.some((nm) => ownerMatches(nm, v))) set.add(v); // 既存名に寄せられない担当のみ追加
    };
    for (const ev of meetingEvents ?? []) addOwner(ev.owner);
    for (const ev of procurementEvents ?? []) addOwner(ev.owner);
    for (const ev of meetingReachedEvents ?? []) addOwner(ev.owner);
    for (const ev of proposalReachedEvents ?? []) addOwner(ev.owner);
    return Array.from(set);
  }, [proposers, closers, teamActivity, meetingEvents, procurementEvents, meetingReachedEvents, proposalReachedEvents, kpiMembers]);

  // 「打ち合わせ」「案件の仕入れ」列の現在値（KPI推移の期間で絞り、担当者名へ寛容突合して集計）。
  //   ※ 提案系（提案中/面談/合格）は StageTargetBoard 側で proposals から算出する。
  const stageCurrentOverrides = useMemo(() => {
    const out: Record<string, Record<string, number>> = {};
    const bump = (rawOwner: string, stage: string) => {
      const who = stageBoardMembers.find((nm) => ownerMatches(nm, rawOwner));
      if (!who) return;
      (out[who] ??= {})[stage] = ((out[who] ??= {})[stage] ?? 0) + 1;
    };
    for (const ev of meetingEvents ?? []) if (inKpiPeriod(ev.date)) bump(ev.owner, "打ち合わせ");
    for (const ev of procurementEvents ?? []) if (inKpiPeriod(ev.date)) bump(ev.owner, "案件の仕入れ");
    for (const ev of meetingReachedEvents ?? []) if (inKpiPeriod(ev.date)) bump(ev.owner, "面談");
    // #234②「提案中」は累計（到達日時ベース）。別フォルダ/失注へ移っても減らず、削除のみ減算。
    for (const ev of proposalReachedEvents ?? []) if (inKpiPeriod(ev.date)) bump(ev.owner, "提案中");
    // 架電（テレアポ）＝アクティビティの contact（期間はサーバ集計済み）。担当者名で按分。
    for (const r of (teamActivity?.rows ?? []) as any[]) {
      const c = Number(r?.actual?.contact ?? 0);
      if (c <= 0) continue;
      const who = stageBoardMembers.find((nm) => ownerMatches(nm, r?.name));
      if (who) (out[who] ??= {})["架電"] = c;
    }
    return out;
  }, [meetingEvents, procurementEvents, meetingReachedEvents, proposalReachedEvents, teamActivity, stageBoardMembers, kpiKp, kpiFrom, kpiTo]);

  // 役割別KGI：インサイド＝面談率（提案→面談）／アウトサイド＝合格率（面談→稼働）。
  //   ・インサイドは提案者責任：面談到達(面談列) ÷ 提案数(アクティビティの proposal)。
  //   ・アウトサイドはクロージング責任：合格/稼働(deal) ÷ 面談(schedule)。
  //   目標率はチームのファネル目標（meetingRate/passRate）。役割未設定は従来KGIにフォールバック。
  const roleKgiByMember = useMemo(() => {
    const rByName: Record<string, "outside" | "inside" | "telapo"> = {};
    for (const [k, v] of Object.entries(roleByMember ?? {})) {
      const who = stageBoardMembers.find((nm) => ownerMatches(nm, k)) ?? k;
      if (v === "outside" || v === "inside" || v === "telapo") rByName[who] = v;
    }
    const actOf = (nm: string): any => (teamActivity?.rows ?? []).find((r: any) => ownerMatches(nm, r?.name))?.actual ?? {};
    const mRate = funnelRates?.meetingRate ?? 0.2;
    const pRate = funnelRates?.passRate ?? 0.33;
    const out: Record<string, { role: "outside" | "inside" | "telapo"; label: string; rate: number | null; targetRate: number; numer: number; denom: number; numerLabel: string; denomLabel: string } | { role: "telapo" }> = {};
    for (const nm of stageBoardMembers) {
      const role = rByName[nm];
      if (!role) continue;
      if (role === "telapo") { out[nm] = { role: "telapo" }; continue; }
      const act = actOf(nm);
      if (role === "inside") {
        const denom = Number(act.proposal ?? 0);
        const numer = Number(stageCurrentOverrides[nm]?.["面談"] ?? 0);
        out[nm] = { role, label: "面談率", numerLabel: "面談", denomLabel: "提案", numer, denom, rate: denom > 0 ? numer / denom : null, targetRate: mRate };
      } else {
        const denom = Number(act.schedule ?? 0);
        const numer = Number(act.deal ?? 0);
        out[nm] = { role, label: "合格率", numerLabel: "合格", denomLabel: "面談", numer, denom, rate: denom > 0 ? numer / denom : null, targetRate: pRate };
      }
    }
    return out;
  }, [roleByMember, funnelRates, teamActivity, stageBoardMembers, stageCurrentOverrides]);

  // ①② KGI逆算ファネルを、ステージ目標ボードと同じ期間連動データから算出する。
  //   提案=「提案中」列 / 面談=「面談」列 / 合格=「合格」列 の実数合計・目標合計を集計し、
  //   チーム全体／アウトサイド／インサイド に分けてバナーへ渡す（実数・目標が表と一致する）。
  const boardFunnels = useMemo(() => {
    // 役割解決はステージ目標ボードと同一にする（roleKgiByMember＝表の役割フィルタと同じ突合）。
    //   これでファネルのアウト/イン タブ合計が、表のアウト/イン絞り込み合計と一致する。
    const roleOfName = (nm: string): string => roleKgiByMember[nm]?.role ?? "";
    // メンバー×ステージの現在値（StageTargetBoard と同一ロジック・同一入力）。
    const cur: Record<string, { prop: number; meet: number; pass: number }> = {};
    const ensure = (nm: string) => (cur[nm] ??= { prop: 0, meet: 0, pass: 0 });
    for (const p of proposalsForStage) {
      const st = normalizeStage(p?.stage);
      // 提案中は累計（stageCurrentOverrides["提案中"]）で集計するためここでは数えない（#234②）。
      if (st === "合格") { const who = stageBoardMembers.find((nm) => ownerMatches(nm, p?.closer)); if (who) ensure(who).pass++; }
    }
    // 提案中・面談は到達ベースの累計（stageCurrentOverrides）から取る（表の「提案中」「面談」列と一致）。
    for (const [owner, byStage] of Object.entries(stageCurrentOverrides)) { ensure(owner).meet = byStage["面談"] ?? 0; ensure(owner).prop = byStage["提案中"] ?? 0; }
    const sumFor = (pred: (nm: string) => boolean) => {
      let proposal = 0, meeting = 0, pass = 0, tProp = 0, tMeet = 0, tWon = 0;
      for (const nm of stageBoardMembers) {
        if (!pred(nm)) continue;
        const c = cur[nm]; const tg = stageTargets?.[nm] ?? {};
        proposal += c?.prop ?? 0; meeting += c?.meet ?? 0; pass += c?.pass ?? 0;
        tProp += tg["提案中"] ?? 0; tMeet += tg["面談"] ?? 0; tWon += tg["合格"] ?? 0;
      }
      return {
        actual: { proposal, meeting, pass },
        target: { proposal: tProp, meeting: tMeet, won: tWon },
        bizPassed: teamFunnel?.bizPassed ?? 0,
        bizTotal: teamFunnel?.bizTotal ?? 0,
        monthLabel: teamActivity?.periodLabel ?? teamFunnel?.monthLabel,
      };
    };
    return {
      all: sumFor(() => true),
      outside: sumFor((nm) => roleOfName(nm) === "outside"),
      inside: sumFor((nm) => roleOfName(nm) === "inside"),
    };
  }, [proposalsForStage, stageCurrentOverrides, stageBoardMembers, stageTargets, roleKgiByMember, teamFunnel, teamActivity]);

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
            display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left", cursor: "pointer",
            border: "1.5px solid #f5b97f", background: "#fff7ed", color: "#9a3412", borderRadius: 12,
            padding: "16px 18px", fontSize: 16, fontWeight: 700, fontFamily: "inherit",
          }}>
          <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 28 }}>notifications_active</span>
          <span>承認待ちが <span style={{ fontSize: 22, fontWeight: 800, margin: "0 1px" }}>{approvalRows.length}</span> 件あります</span>
          <span style={{ marginLeft: "auto", fontWeight: 700, color: "#b45309", fontSize: 14.5, whiteSpace: "nowrap" }}>承認タブを開く ›</span>
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
        {/* KPI推移も他タブと同じ位置（タブ右）に期間を置く（2段にせず1段に揃える）。 */}
        {tab === "kpi" && (
          <div style={{ paddingBottom: 6 }}>
            <KpiPeriodBar current={kpiProps?.period} card={false} note="" />
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
            {/* KGI逆算ファネル（営業マニュアル§10）：当月の 提案→面談→合格→稼働 を常時トップ表示。 */}
            <KgiFunnelBanner funnel={boardFunnels.all} funnelsByRole={boardFunnels} allowForecast={kpiKp === "month"} />
            {/* 期間切替はタブ右に移動（他タブと同じ位置・1段）。このバーがダッシュボード・各表すべてに連動。 */}
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
                      {/* #234①：この表（タブ）内にも「チーム目標を編集（週次）」を設置（メンバー別アクティビティと同じ）。 */}
                      {privileged && teamActivity?.weekStart && (
                        <button type="button" className="btn ghost btn-xs" onClick={() => setStageTeamEdit(true)} title="チームの週次目標を編集">
                          <span className="material-symbols-outlined" style={{ fontSize: 14, verticalAlign: "-3px", marginRight: 2 }}>flag</span>
                          チーム目標を編集（週次）
                        </button>
                      )}
                      {/* ① この表の隣にも期間フィルターを置く（上部までスクロールせず期間を切り替えられる）。 */}
                      <div style={{ marginLeft: "auto" }}>
                        <KpiPeriodBar current={kpiProps?.period} card={false} note="" />
                      </div>
                    </div>
                    {stageTeamEdit && teamActivity?.weekStart && (
                      <TargetEditModal scope="team" weekStart={teamActivity.weekStart}
                        title="チーム目標を編集（週次）" subtitle="会社全体（its）の週次目標。期間に応じて按分されます。"
                        initial={teamActivity.teamWeeklyTarget ?? {}} onClose={() => setStageTeamEdit(false)} />
                    )}
                    <div className="muted" style={{ fontSize: 11, marginBottom: 12 }}>打ち合わせ → 案件の仕入れ → 提案中 → 面談 → 合格（稼働決定） の目標/現在/達成率</div>
                    {/* ②③ メンバー編集・追加・削除（チーム：アウトサイド/インサイド/テレアポ）。打ち合わせ記録の自社担当にも連動。 */}
                    <KpiMembersEditor initial={kpiMembers ?? []} suggestions={kpiMemberSuggestions ?? []} canEdit={!!privileged} />
                    <StageTargetBoard
                      proposals={proposalsForStage}
                      members={stageBoardMembers}
                      stageTargets={stageTargets ?? {}}
                      currentOverrides={stageCurrentOverrides}
                      kgiByMember={kgiByMember ?? {}}
                      roleByMember={roleByMember ?? {}}
                      roleKgiByMember={roleKgiByMember}
                      kpiPctByMember={kpiPctByMember}
                      currentUserName={currentUserName}
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
