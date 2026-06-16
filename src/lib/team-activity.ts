// メンバー別アクティビティ集計（ダッシュボード／KPI推移の「誰が何をやったか」一覧）。
//   指標は KPI推移と同じ5つに統一（提案 / コンタクト / 調整中 / 日程確定 / 成約）。
//     ・提案     : ステータスが「提案中」以降の提案を proposer に加算（承認待ち/所属確認/失注は除外・created_at が期間内）
//     ・コンタクト: 架電状況が未架電/空白以外（closer に加算・updated_at 起点）
//     ・調整中   : 案件/人材の通知のいずれかが「処理中/完了」（closer に加算・updated_at 起点）
//     ・日程確定 : 現在ステータスが「面談」のもの＝面談フォルダ件数（closer に加算・stage_updated_at 起点）
//     ・成約     : 「合格」到達済み＝合格/稼働（closer に加算・stage_updated_at 起点）
//   各メンバーの週次目標（kpi_targets person scope）も取得し、期間に按分して達成率を出す。

import { engerAdmin, engerClient, dbConfigured } from "./supabase";
import { ownerMatches } from "./owner-match";
import { metricFlags, METRIC_ORDER, jstStartOfWeek, businessDaysInRange, type Metric } from "./kpi";

export type ActivityRow = {
  name: string;
  email: string | null;
  actual: Record<Metric, number>;
  target: Record<Metric, number>; // 期間に按分した目標
  total: number;                  // 実績合計（一目の活動量）
  targetTotal: number;            // 目標合計
};

export type Member = { name: string; email?: string | null };

const iso = (d: Date) => d.toISOString();

const zeroMetrics = (): Record<Metric, number> => ({ proposal: 0, contact: 0, adjusting: 0, schedule: 0, deal: 0 });

/** 期間内の各メンバーのアクティビティ（5指標）と按分目標を集計。 */
export async function getTeamActivity(opts: { start: Date; end: Date; members: Member[] }): Promise<ActivityRow[]> {
  const { start, end, members } = opts;
  const rows: ActivityRow[] = members.map((m) => ({
    name: m.name, email: m.email ?? null,
    actual: zeroMetrics(), target: zeroMetrics(), total: 0, targetTotal: 0,
  }));
  if (!dbConfigured || members.length === 0) return rows;

  let sb: ReturnType<typeof engerClient>;
  try { sb = engerAdmin(); } catch { sb = engerClient(); }

  const sIso = iso(start), eIso = iso(end);

  // 提案（広めに取得して本人判定はJS側で）。承認待ち/差戻し中は KPI(提案) から除外。
  let pr: any = await sb.from("proposals")
    .select("proposer, closer, stage, created_at, stage_updated_at, updated_at, caller_status, job_notify_status, cand_notify_status, approval_status")
    .or(`created_at.gte.${sIso},stage_updated_at.gte.${sIso},updated_at.gte.${sIso}`).limit(20000);
  if (pr.error && /approval_status|column/i.test(pr.error.message ?? "")) {
    pr = await sb.from("proposals")
      .select("proposer, closer, stage, created_at, stage_updated_at, updated_at, caller_status, job_notify_status, cand_notify_status")
      .or(`created_at.gte.${sIso},stage_updated_at.gte.${sIso},updated_at.gte.${sIso}`).limit(20000);
  }
  if (pr.error) pr = await sb.from("proposals")
    .select("proposer, closer, stage, created_at, stage_updated_at").or(`created_at.gte.${sIso},stage_updated_at.gte.${sIso}`).limit(20000);
  const props: any[] = pr.error ? [] : (pr.data ?? []);

  const inIso = (d: string | null) => !!d && d >= sIso && d < eIso;
  const isApproved = (p: any) => {
    const s = String(p?.approval_status ?? "").trim();
    return s !== "pending" && s !== "rejected";
  };
  // proposer / closer どちらかが一致する行を見つけて加算
  const bumpByName = (value: string | null | undefined, metric: Metric) => {
    if (!value) return;
    for (const row of rows) if (ownerMatches(row.name, value)) { row.actual[metric]++; return; }
  };

  for (const p of props) {
    // 提案＝提案者。期間内に作成された提案を計上（提案管理の件数と一致）。承認待ち/差戻しは除外。
    if (isApproved(p) && inIso(p.created_at)) bumpByName(p.proposer, "proposal");
    // それ以外＝CL担当（closer）
    const ev = p.stage_updated_at ?? p.updated_at ?? null;
    const evAny = p.updated_at ?? p.stage_updated_at ?? null;
    if (metricFlags.isContact(p)   && inIso(evAny)) bumpByName(p.closer, "contact");
    if (metricFlags.isAdjusting(p) && inIso(evAny)) bumpByName(p.closer, "adjusting");
    if (metricFlags.isSchedule(p)  && inIso(ev))    bumpByName(p.closer, "schedule");
    if (metricFlags.isDeal(p)      && inIso(ev))    bumpByName(p.closer, "deal");
  }

  // 各メンバーの週次目標（person scope）を取得して期間に按分。
  const emails = members.map((m) => (m.email ?? "").toLowerCase()).filter(Boolean);
  if (emails.length > 0) {
    const ws = jstStartOfWeek(start).toISOString().slice(0, 10);
    const bd = Math.max(1, businessDaysInRange(start, end));
    try {
      const tr: any = await sb.from("kpi_targets")
        .select("owner_email, metric, target").eq("scope", "person").eq("week_start", ws).in("owner_email", emails);
      if (!tr.error) {
        for (const t of (tr.data ?? []) as any[]) {
          const row = rows.find((r) => (r.email ?? "").toLowerCase() === String(t.owner_email ?? "").toLowerCase());
          if (row && METRIC_ORDER.includes(t.metric)) {
            // 週次 → 期間按分（営業日比）。日/週/月いずれでも自然に効く。
            row.target[t.metric as Metric] = Math.round((Number(t.target) * bd) / 5);
          }
        }
      }
    } catch { /* kpi_targets 未整備でも続行 */ }
  }

  for (const row of rows) {
    row.total = METRIC_ORDER.reduce((s, m) => s + row.actual[m], 0);
    row.targetTotal = METRIC_ORDER.reduce((s, m) => s + row.target[m], 0);
  }
  return rows;
}
