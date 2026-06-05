// メンバー進捗ダッシュボード（管理者＝全社／マネージャー・リーダー＝自部署）。
//   ★ KGIの中心が「稼働数」になったため、メンバーの主役指標を「今月の稼働化数」に変更。
//     - 稼働化（提案者として）：自分が提案者だった稼働が今月何件決まったか
//     - 稼働化（クロージングとして）：自分がクロージング担当だった稼働が今月何件決まったか
//     ※ 1つの稼働は「提案者」と「クローザー」の双方にカウントされる（案D：両方表示）。
//   活動量（今月の提案・今週の打合せ）は補助指標として併記する。

import { engerAdmin, engerClient, dbConfigured } from "@/lib/supabase";
import { listAccounts, listDepartmentMemberNames } from "@/lib/accounts";

type Scope = "all" | "department";

const TARGET_PROPOSAL_MONTH = 20;
const TARGET_MEETING_WEEK = 3;

type Row = {
  name: string;
  department: string | null;
  teamRole: string | null;
  placedAsProposer: number;   // 今月の稼働化（提案者として）
  placedAsCloser: number;     // 今月の稼働化（クロージングとして）
  proposalsMonth: number;     // 今月の提案数（活動量）
  meetingsWeek: number;       // 今週の打合せ数（活動量）
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
  const monthStartIso = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  // 提案・打合せ・稼働をまとめて取得（service role で RLS を越える）。
  let proposals: { proposer: string | null; created_at: string }[] = [];
  let meetings: { our_owner: string | null; meeting_date: string | null }[] = [];
  let engagements: { proposal_id: string | null; created_at: string }[] = [];
  let sb: ReturnType<typeof engerClient>;
  try {
    try { sb = engerAdmin(); } catch { sb = engerClient(); }
    const [pr, mt, eng] = await Promise.all([
      sb.from("proposals").select("proposer, created_at").gte("created_at", monthStartIso).limit(3000),
      sb.from("meetings").select("our_owner, meeting_date").gte("meeting_date", weekAgo).limit(2000),
      // 今月「稼働化」した稼働（created_at が当月）。提案者/クローザーは紐づく proposal から引く。
      sb.from("engagements").select("proposal_id, created_at").gte("created_at", monthStartIso).limit(3000),
    ]);
    proposals = (pr.data ?? []) as any[];
    meetings = (mt.data ?? []) as any[];
    engagements = (eng.data ?? []) as any[];
  } catch {
    // テーブル未整備でも進捗0で続行
  }

  // 今月の稼働化を「提案者」「クロージング担当」へ割り当てる。
  //   1) 当月稼働の proposal_id を集める
  //   2) その提案の proposer / closer を引く
  //   3) それぞれ氏名でカウント（同一稼働は双方に1件ずつ）
  const placedProposer = new Map<string, number>();
  const placedCloser = new Map<string, number>();
  try {
    const monthEngs = engagements.filter((e) => e.proposal_id && String(e.created_at ?? "").slice(0, 7) === monthPrefix);
    const propIds = Array.from(new Set(monthEngs.map((e) => e.proposal_id as string)));
    if (propIds.length > 0) {
      const prRes = await sb!.from("proposals").select("id, proposer, closer").in("id", propIds).limit(3000);
      const byId = new Map<string, { proposer: string | null; closer: string | null }>();
      for (const p of (prRes.data ?? []) as any[]) byId.set(p.id, { proposer: p.proposer ?? null, closer: p.closer ?? null });
      for (const e of monthEngs) {
        const p = byId.get(e.proposal_id as string);
        if (!p) continue;
        if (p.proposer) placedProposer.set(p.proposer, (placedProposer.get(p.proposer) ?? 0) + 1);
        if (p.closer) placedCloser.set(p.closer, (placedCloser.get(p.closer) ?? 0) + 1);
      }
    }
  } catch {
    // 取得失敗時は0扱い
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
    placedAsProposer: placedProposer.get(m.name) ?? 0,
    placedAsCloser: placedCloser.get(m.name) ?? 0,
    proposalsMonth: propByName.get(m.name) ?? 0,
    meetingsWeek: mtgByName.get(m.name) ?? 0,
  }));

  // 稼働化の合計（提案者＋クローザー）降順 → 同点は提案数で。稼働数を最重視。
  rows.sort((a, b) => {
    const pb = (b.placedAsProposer + b.placedAsCloser) - (a.placedAsProposer + a.placedAsCloser);
    if (pb !== 0) return pb;
    return b.proposalsMonth - a.proposalsMonth;
  });

  const totalPlaced = rows.reduce((s, r) => s + r.placedAsProposer + r.placedAsCloser, 0);
  const heading = scope === "all" ? "🏢 全社メンバー進捗（稼働数）" : `👥 ${departmentName} メンバー進捗（稼働数）`;
  const subtitle = scope === "all"
    ? "全エージェント・管理者の今月の稼働化数を最重視。提案者／クロージング担当それぞれで集計。"
    : "同部署メンバーの今月の稼働化数。マネージャー／リーダーは「誰の提案で・誰がクローズしたか」を把握できます。";

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>{heading}</h3>
          <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{subtitle}</div>
        </div>
        <span className="muted" style={{ fontSize: 11 }}>
          今月の稼働化 合計 <b style={{ color: "var(--color-brand-700)", fontSize: 13 }}>{totalPlaced}</b> 件
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(130px, 200px) 1fr 1fr 1.4fr", gap: 12, padding: "6px 10px", fontSize: 10.5, fontWeight: 700, color: "var(--color-ink-4)", letterSpacing: ".04em" }}>
          <span>メンバー</span>
          <span>🎯 稼働化・提案者（今月）</span>
          <span>🎯 稼働化・クロージング（今月）</span>
          <span>活動量（提案/月・打合せ/週）</span>
        </div>
        {rows.map((r) => {
          const isMe = myName && r.name === myName;
          return (
            <div key={r.name} style={{
              display: "grid", gridTemplateColumns: "minmax(130px, 200px) 1fr 1fr 1.4fr", gap: 12,
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
              <PlacedBadge value={r.placedAsProposer} tone="brand" />
              <PlacedBadge value={r.placedAsCloser} tone="accent" />
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <MiniBar label="提案" value={r.proposalsMonth} target={TARGET_PROPOSAL_MONTH} />
                <MiniBar label="打合せ" value={r.meetingsWeek} target={TARGET_MEETING_WEEK} />
              </div>
            </div>
          );
        })}
      </div>

      <div className="muted" style={{ fontSize: 11, marginTop: 10 }}>
        ※ 稼働化＝今月ひも付けられた稼働の件数。1つの稼働は「提案者」と「クロージング担当」の双方に1件ずつ計上されます（重複ではなく役割別の貢献）。
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

// 稼働化件数を大きく見せるバッジ。0件は控えめに。
function PlacedBadge({ value, tone }: { value: number; tone: "brand" | "accent" }) {
  const on = value > 0;
  const color = tone === "brand" ? "var(--color-brand-700)" : "#067647";
  const bg = on ? (tone === "brand" ? "var(--color-brand-25)" : "rgba(6,118,71,.08)") : "var(--color-surface-inset)";
  const border = on ? (tone === "brand" ? "var(--color-brand-100)" : "rgba(6,118,71,.25)") : "var(--color-border)";
  return (
    <div style={{ display: "inline-flex", alignItems: "baseline", gap: 4, padding: "6px 14px", borderRadius: 10, background: bg, border: `1px solid ${border}`, width: "fit-content" }}>
      <span className="mono" style={{ fontSize: 20, fontWeight: 800, color: on ? color : "var(--color-ink-4)" }}>{value}</span>
      <span style={{ fontSize: 10.5, color: "var(--color-ink-4)" }}>件</span>
    </div>
  );
}

function MiniBar({ label, value, target }: { label: string; value: number; target: number }) {
  const pct = target > 0 ? Math.min(100, Math.round((value / target) * 100)) : 0;
  const done = value >= target;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ fontSize: 10, color: "var(--color-ink-4)", width: 36, flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, height: 5, borderRadius: 99, background: "var(--color-surface-inset)", overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: done ? "#1aa260" : "var(--color-brand-600)", transition: "width .25s" }} />
      </div>
      <span className="mono" style={{ fontSize: 10.5, fontWeight: 700, color: done ? "#067647" : "var(--color-ink-3)", width: 44, textAlign: "right", flexShrink: 0 }}>
        {value}/{target}
      </span>
    </div>
  );
}
