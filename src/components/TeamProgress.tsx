// メンバー進捗ダッシュボード（管理者＝全社／マネージャー・リーダー＝自部署）。
//   各メンバーの「提案（今月）」「打合せ（今週）」の活動量を一覧表示し、達成度を進捗バーで可視化する。
//   ※ 目標値は当面 AgentDashboard と同じ既定値（提案20件/月、打合せ3件/週）を使用。
//     マネージャー/部下別の個別目標の編集UIは次フェーズで kpi_targets を本格利用して追加する。

import { engerAdmin, engerClient, dbConfigured } from "@/lib/supabase";
import { listAccounts, listDepartmentMemberNames } from "@/lib/accounts";

type Scope = "all" | "department";

const TARGET_PROPOSAL_MONTH = 20;
const TARGET_MEETING_WEEK = 3;

type Row = {
  name: string;
  department: string | null;
  teamRole: string | null;
  proposalsMonth: number;
  meetingsWeek: number;
};

export async function TeamProgress({ scope, departmentName, myName }: { scope: Scope; departmentName?: string | null; myName?: string | null }) {
  if (!dbConfigured) return null;

  // 対象メンバーの氏名を集める。全社（admin） or 自部署のみ（manager/leader）。
  let members: { name: string; department: string | null; teamRole: string | null }[] = [];
  try {
    if (scope === "all") {
      const accs = await listAccounts();
      members = accs
        .filter((a) => a.status === "active" && (a.role === "admin" || a.role === "agent") && a.name)
        .map((a) => ({ name: a.name!, department: (a as any).department ?? null, teamRole: (a as any).team_role ?? null }));
    } else {
      if (!departmentName) return null;
      const names = await listDepartmentMemberNames(departmentName);
      members = names.map((n) => ({ name: n, department: departmentName, teamRole: null }));
    }
  } catch {
    return null;
  }
  if (members.length === 0) return null;

  // 当月・当週のキー
  const now = new Date();
  const monthPrefix = now.toISOString().slice(0, 7);
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

  // 提案・打合せをまとめて取得（service role で RLS を越える）。
  let proposals: { proposer: string | null; created_at: string }[] = [];
  let meetings: { our_owner: string | null; meeting_date: string | null }[] = [];
  try {
    let sb: ReturnType<typeof engerClient>;
    try { sb = engerAdmin(); } catch { sb = engerClient(); }
    // 当月分のみで充分（KPI=今月の提案数）
    const monthStartIso = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const [pr, mt] = await Promise.all([
      sb.from("proposals").select("proposer, created_at").gte("created_at", monthStartIso).limit(3000),
      sb.from("meetings").select("our_owner, meeting_date").gte("meeting_date", weekAgo).limit(2000),
    ]);
    proposals = (pr.data ?? []) as any[];
    meetings = (mt.data ?? []) as any[];
  } catch {
    // テーブル未整備でも進捗0で続行
  }

  const propByName = new Map<string, number>();
  for (const p of proposals) {
    if (!p.proposer) continue;
    if (String(p.created_at ?? "").slice(0, 7) !== monthPrefix) continue;
    propByName.set(p.proposer, (propByName.get(p.proposer) ?? 0) + 1);
  }
  const mtgByName = new Map<string, number>();
  for (const m of meetings) {
    if (!m.our_owner) continue;
    if (String(m.meeting_date ?? "").slice(0, 10) < weekAgo) continue;
    mtgByName.set(m.our_owner, (mtgByName.get(m.our_owner) ?? 0) + 1);
  }

  const rows: Row[] = members.map((m) => ({
    name: m.name,
    department: m.department,
    teamRole: m.teamRole,
    proposalsMonth: propByName.get(m.name) ?? 0,
    meetingsWeek: mtgByName.get(m.name) ?? 0,
  }));

  // 達成率で降順（提案＋打合せの合計達成率）
  const ach = (r: Row) =>
    (r.proposalsMonth / TARGET_PROPOSAL_MONTH) + (r.meetingsWeek / TARGET_MEETING_WEEK);
  rows.sort((a, b) => ach(b) - ach(a));

  const heading = scope === "all" ? "🏢 全社メンバー進捗" : `👥 ${departmentName} メンバー進捗`;
  const subtitle = scope === "all"
    ? "全エージェント・管理者の今月の提案／今週の打合せ。目標達成順。"
    : "同部署メンバーの今月の提案／今週の打合せ。マネージャー／リーダーは部下の進捗を把握できます。";

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>{heading}</h3>
          <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{subtitle}</div>
        </div>
        <span className="muted" style={{ fontSize: 11 }}>
          目標：提案 <b style={{ color: "var(--color-ink)" }}>{TARGET_PROPOSAL_MONTH}</b>/月 ・ 打合せ <b style={{ color: "var(--color-ink)" }}>{TARGET_MEETING_WEEK}</b>/週
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(140px, 220px) 1fr 1fr", gap: 12, padding: "6px 10px", fontSize: 10.5, fontWeight: 700, color: "var(--color-ink-4)", letterSpacing: ".04em" }}>
          <span>メンバー</span>
          <span>提案（今月）</span>
          <span>打合せ（今週）</span>
        </div>
        {rows.map((r) => {
          const isMe = myName && r.name === myName;
          return (
            <div key={r.name} style={{
              display: "grid", gridTemplateColumns: "minmax(140px, 220px) 1fr 1fr", gap: 12,
              alignItems: "center", padding: "9px 10px",
              border: "1px solid var(--color-border)", borderRadius: 8,
              background: isMe ? "var(--color-brand-25)" : "var(--color-surface)",
            }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 2, overflow: "hidden" }}>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--color-ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {r.name}{isMe ? <span style={{ marginLeft: 6, fontSize: 10, color: "var(--color-brand-700)" }}>あなた</span> : null}
                </span>
                <span className="muted" style={{ fontSize: 10.5 }}>
                  {r.department ?? "未所属"}{r.teamRole ? ` ・ ${labelOf(r.teamRole)}` : ""}
                </span>
              </div>
              <ProgressBar value={r.proposalsMonth} target={TARGET_PROPOSAL_MONTH} unit="件" />
              <ProgressBar value={r.meetingsWeek} target={TARGET_MEETING_WEEK} unit="件" />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function labelOf(teamRole: string): string {
  if (teamRole === "manager") return "マネージャー";
  if (teamRole === "leader") return "リーダー";
  if (teamRole === "member") return "メンバー";
  return teamRole;
}

function ProgressBar({ value, target, unit }: { value: number; target: number; unit: string }) {
  const pct = target > 0 ? Math.min(100, Math.round((value / target) * 100)) : 0;
  const done = value >= target;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span className="mono" style={{ fontSize: 13, fontWeight: 800, color: done ? "#067647" : "var(--color-ink)" }}>
          {value}<span style={{ fontSize: 10, color: "var(--color-ink-4)" }}>/{target}{unit}</span>
        </span>
        <span className="mono" style={{ fontSize: 10.5, fontWeight: 700, color: done ? "#067647" : pct >= 50 ? "var(--color-brand-700)" : "var(--color-ink-3)" }}>
          {pct}%
        </span>
      </div>
      <div style={{ height: 5, borderRadius: 99, background: "var(--color-surface-inset)", overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: done ? "#1aa260" : "var(--color-brand-600)", transition: "width .25s" }} />
      </div>
    </div>
  );
}
