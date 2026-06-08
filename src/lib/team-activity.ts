// メンバー別アクティビティ集計（KPIダッシュボードの「誰が何をやったか」一覧用）。
//   指定期間 [start, end) について、各メンバーの動きを1パスで集計する。
//     ・提案     : proposals.proposer（created_at が期間内）
//     ・面談     : meetings.our_owner（meeting_date が期間内）
//     ・人材登録 : candidates.operator（created_at が期間内）
//     ・案件登録 : jobs.operator（created_at が期間内）
//     ・稼働化   : proposals.stage∈(稼働決定/稼働)（stage_updated_at が期間内・proposer/closer合算）
//   担当名は略称↔フルネームに寛容な ownerMatches で突き合わせる。

import { engerAdmin, engerClient, dbConfigured } from "./supabase";
import { ownerMatches } from "./owner-match";

export type ActivityRow = {
  name: string;
  email: string | null;
  proposals: number;   // 新規提案
  meetings: number;    // 面談
  candRegs: number;    // 人材登録
  jobRegs: number;     // 案件登録
  won: number;         // 稼働化
  total: number;       // 合計（一目の活動量）
};

export type Member = { name: string; email?: string | null };

const iso = (d: Date) => d.toISOString();
const dateOnly = (d: Date) => d.toISOString().slice(0, 10);

/** 期間内の各メンバーのアクティビティを集計。 */
export async function getTeamActivity(opts: { start: Date; end: Date; members: Member[] }): Promise<ActivityRow[]> {
  const { start, end, members } = opts;
  const rows: ActivityRow[] = members.map((m) => ({
    name: m.name, email: m.email ?? null,
    proposals: 0, meetings: 0, candRegs: 0, jobRegs: 0, won: 0, total: 0,
  }));
  if (!dbConfigured || members.length === 0) return rows;

  let sb: ReturnType<typeof engerClient>;
  try { sb = engerAdmin(); } catch { sb = engerClient(); }

  const sIso = iso(start), eIso = iso(end);
  const sDate = dateOnly(start), eDate = dateOnly(end);

  // operator 列は attribution-operator.sql 適用後のみ存在。失敗時は登録系を 0 のままにする。
  const safeOperator = async (table: "candidates" | "jobs") => {
    try {
      const r: any = await sb.from(table).select("operator, created_at").gte("created_at", sIso).lt("created_at", eIso).limit(20000);
      if (r.error) return [];
      return (r.data ?? []) as any[];
    } catch { return []; }
  };

  const [pr, mr, cr, jr] = await Promise.all([
    sb.from("proposals").select("proposer, closer, stage, created_at, stage_updated_at")
      .or(`created_at.gte.${sIso},stage_updated_at.gte.${sIso}`).limit(20000),
    sb.from("meetings").select("our_owner, meeting_date").gte("meeting_date", sDate).lt("meeting_date", eDate).limit(20000),
    safeOperator("candidates"),
    safeOperator("jobs"),
  ]);

  const props: any[] = (pr as any).error ? [] : ((pr as any).data ?? []);
  const meets: any[] = (mr as any).error ? [] : ((mr as any).data ?? []);
  const cands: any[] = cr;
  const jobs: any[] = jr;

  const inIso = (d: string | null) => !!d && d >= sIso && d < eIso;
  // 担当名 → 行 の対応（最初に一致したメンバーへ加算）
  const bump = (value: string | null | undefined, key: keyof ActivityRow) => {
    if (!value) return;
    for (const row of rows) {
      if (ownerMatches(row.name, value)) { (row[key] as number)++; return; }
    }
  };

  for (const p of props) {
    if (inIso(p.created_at)) bump(p.proposer, "proposals");
    if (inIso(p.stage_updated_at) && (p.stage === "稼働決定" || p.stage === "稼働")) {
      // proposer と closer の双方に計上（同一人物の二重計上は避ける）
      bump(p.proposer, "won");
      if (p.closer && !ownerMatches(p.proposer ?? "", p.closer)) bump(p.closer, "won");
    }
  }
  for (const m of meets) {
    if (m.meeting_date >= sDate && m.meeting_date < eDate) bump(m.our_owner, "meetings");
  }
  for (const c of cands) if (inIso(c.created_at)) bump(c.operator, "candRegs");
  for (const j of jobs) if (inIso(j.created_at)) bump(j.operator, "jobRegs");

  for (const row of rows) row.total = row.proposals + row.meetings + row.candRegs + row.jobRegs + row.won;
  return rows;
}
