// メンバー進捗ダッシュボード（管理者＝全社／マネージャー・リーダー＝自部署）。
//   ★ KGIの中心が「稼働数」になったため、メンバーの主役指標を「今月の稼働化数」に変更。
//     - 稼働化（提案者として）：自分が提案者だった稼働が今月何件決まったか
//     - 稼働化（クロージングとして）：自分がクロージング担当だった稼働が今月何件決まったか
//     ※ 1つの稼働は「提案者」と「クローザー」の双方にカウントされる（案D：両方表示）。
//   活動量（今月の提案・今週の打合せ）は補助指標として併記する。

import { engerAdmin, engerClient, dbConfigured } from "@/lib/supabase";
import { listAccounts, listDepartmentMemberNames } from "@/lib/accounts";
import { listPersonKgi, monthKey } from "@/lib/person-kgi";
import { TeamMemberMessage } from "./TeamMemberMessage";

type Scope = "all" | "department";

const TARGET_PROPOSAL_MONTH = 20;
const TARGET_MEETING_WEEK = 3;

type Row = {
  name: string;
  email: string | null;
  department: string | null;
  teamRole: string | null;
  placedAsProposer: number;   // 今月の稼働化（提案者として）
  placedAsCloser: number;     // 今月の稼働化（クロージングとして）
  placedTotal: number;        // 提案者+クロージング（KGI評価対象）
  kgiTarget: number | null;   // 個人月次KGI（稼働化目標）
  kgiPct: number | null;      // 達成率（%、KGIが無いと null）
  proposalsMonth: number;     // 今月の提案数（活動量）
  meetingsWeek: number;       // 今週の打合せ数（活動量）
  reportYesterday: boolean;   // 昨日(=直前営業日)の日報を出したか
  lastReportDate: string | null; // 直近の日報日付（YYYY-MM-DD）
};

export async function TeamProgress({ scope, departmentName, myName }: { scope: Scope; departmentName?: string | null; myName?: string | null }) {
  if (!dbConfigured) return null;

  // 対象メンバーの氏名/メールを集める。全社（admin） or 自部署のみ（manager/leader）。
  // KGI（個人月次目標）の突合は email キーで行うため、可能なら email も保持する。
  let members: { name: string; email: string | null; department: string | null; teamRole: string | null }[] = [];
  try {
    if (scope === "all") {
      const accs = await listAccounts();
      members = accs
        .filter((a) => a.status === "active" && (a.role === "admin" || a.role === "agent") && a.name)
        .map((a) => ({ name: a.name!, email: a.email ?? null, department: (a as any).department ?? null, teamRole: (a as any).team_role ?? null }));
    } else {
      if (!departmentName) return null;
      // 部署スコープでも email を取りたいので listAccounts から自部署を絞る（軽量）。
      const accs = await listAccounts();
      members = accs
        .filter((a) => a.status === "active" && (a.role === "admin" || a.role === "agent") && a.name && (a as any).department === departmentName)
        .map((a) => ({ name: a.name!, email: a.email ?? null, department: (a as any).department ?? null, teamRole: (a as any).team_role ?? null }));
      // フォールバック：listDepartmentMemberNames で名前だけ取れる場合（マスタ未整備対策）
      if (members.length === 0) {
        const names = await listDepartmentMemberNames(departmentName);
        members = names.map((n) => ({ name: n, email: null, department: departmentName, teamRole: null }));
      }
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
  // 「昨日」＝日報の評価基準日。土日は直近の金曜に丸める。
  const yesterdayKey = (() => {
    const d = new Date(); d.setDate(d.getDate() - 1);
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  })();
  // 直近の日報を判定するため、過去14日分を取得対象に。
  const reportSince = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);

  // 提案・打合せ・稼働・日報 をまとめて取得（service role で RLS を越える）。
  let proposals: { proposer: string | null; created_at: string }[] = [];
  let meetings: { our_owner: string | null; meeting_date: string | null }[] = [];
  let engagements: { proposal_id: string | null; created_at: string }[] = [];
  let reports: { author: string | null; report_date: string }[] = [];
  let sb: ReturnType<typeof engerClient>;
  try {
    try { sb = engerAdmin(); } catch { sb = engerClient(); }
    const [pr, mt, eng, rep] = await Promise.all([
      sb.from("proposals").select("proposer, created_at").gte("created_at", monthStartIso).limit(3000),
      sb.from("meetings").select("our_owner, meeting_date").gte("meeting_date", weekAgo).limit(2000),
      // 今月「稼働化」した稼働（created_at が当月）。提案者/クローザーは紐づく proposal から引く。
      sb.from("engagements").select("proposal_id, created_at").gte("created_at", monthStartIso).limit(3000),
      // 直近14日の日報（部下の昨日提出 / 最終提出日 を判定するため）
      sb.from("daily_reports").select("author, report_date").gte("report_date", reportSince).limit(2000),
    ]);
    proposals = (pr.data ?? []) as any[];
    meetings = (mt.data ?? []) as any[];
    engagements = (eng.data ?? []) as any[];
    reports = (rep.data ?? []) as any[];
  } catch {
    // テーブル未整備でも進捗0で続行
  }

  // 部下別の最終提出日と『昨日提出』フラグを算出
  const lastReportByName = new Map<string, string>();
  const reportYesterdaySet = new Set<string>();
  for (const r of reports) {
    if (!r.author) continue;
    const cur = lastReportByName.get(r.author);
    if (!cur || r.report_date > cur) lastReportByName.set(r.author, r.report_date);
    if (r.report_date === yesterdayKey) reportYesterdaySet.add(r.author);
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

  // 個人KGI（当月）を email キーで一括取得。
  const kgis = await listPersonKgi(monthKey(now), scope === "department" ? { department: departmentName } : undefined);
  const kgiByEmail = new Map<string, number>();
  for (const k of kgis) if (k.placement_target != null) kgiByEmail.set((k.owner_email ?? "").toLowerCase(), k.placement_target);

  const rows: Row[] = members.map((m) => {
    const placedAsProposer = placedProposer.get(m.name) ?? 0;
    const placedAsCloser = placedCloser.get(m.name) ?? 0;
    const placedTotal = placedAsProposer + placedAsCloser;
    const kgiTarget = m.email ? (kgiByEmail.get(m.email.toLowerCase()) ?? null) : null;
    const kgiPct = (kgiTarget != null && kgiTarget > 0) ? Math.min(100, Math.round((placedTotal / kgiTarget) * 100)) : null;
    return {
      name: m.name, email: m.email, department: m.department, teamRole: m.teamRole,
      placedAsProposer, placedAsCloser, placedTotal, kgiTarget, kgiPct,
      proposalsMonth: propByName.get(m.name) ?? 0,
      meetingsWeek: mtgByName.get(m.name) ?? 0,
      reportYesterday: reportYesterdaySet.has(m.name),
      lastReportDate: lastReportByName.get(m.name) ?? null,
    };
  });

  // 並び順：要対応（日報未提出 → KGI未設定 → 達成率低い）を先頭。
  //   マネージャーが『どの部下を今日助けるか』が一目で分かる順序。
  rows.sort((a, b) => {
    // 1) 日報未提出を最上位
    if (a.reportYesterday !== b.reportYesterday) return a.reportYesterday ? 1 : -1;
    // 2) KGI未設定 → 達成率50%未満 → それ以外
    const aDanger = a.kgiTarget == null ? 2 : a.kgiPct! < 50 ? 1 : 0;
    const bDanger = b.kgiTarget == null ? 2 : b.kgiPct! < 50 ? 1 : 0;
    if (aDanger !== bDanger) return bDanger - aDanger;
    // 3) 達成率昇順
    if (a.kgiPct != null && b.kgiPct != null) return a.kgiPct - b.kgiPct;
    // 4) 名前順
    return a.name.localeCompare(b.name);
  });

  const totalPlaced = rows.reduce((s, r) => s + r.placedTotal, 0);
  const totalKgi = rows.reduce((s, r) => s + (r.kgiTarget ?? 0), 0);
  const overallPct = totalKgi > 0 ? Math.min(100, Math.round((totalPlaced / totalKgi) * 100)) : null;
  const noKgiCount = rows.filter((r) => r.kgiTarget == null).length;
  const behindCount = rows.filter((r) => r.kgiPct != null && r.kgiPct < 50).length;
  const missingReportCount = rows.filter((r) => !r.reportYesterday).length;
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
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", fontSize: 11 }}>
          {overallPct != null && (
            <span>
              チーム達成率 <b style={{ color: overallPct >= 80 ? "#067647" : overallPct >= 50 ? "#b45309" : "#b42318", fontSize: 14 }}>{overallPct}%</b>
              <span className="muted" style={{ marginLeft: 4 }}>({totalPlaced}/{totalKgi})</span>
            </span>
          )}
          {missingReportCount > 0 && (
            <span style={{ color: "#b42318", fontWeight: 700 }}>📓 日報未提出 {missingReportCount}名（{yesterdayKey}）</span>
          )}
          {noKgiCount > 0 && (
            <span style={{ color: "#b45309", fontWeight: 700 }}>⚠ KGI未設定 {noKgiCount}名</span>
          )}
          {behindCount > 0 && (
            <span style={{ color: "#b42318", fontWeight: 700 }}>🚨 達成率50%未満 {behindCount}名</span>
          )}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(130px, 180px) minmax(160px, 1.4fr) 60px 60px 1fr 110px", gap: 10, padding: "6px 10px", fontSize: 10.5, fontWeight: 700, color: "var(--color-ink-4)", letterSpacing: ".04em" }}>
          <span>メンバー</span>
          <span>🏁 KGI達成（稼働化/目標）</span>
          <span style={{ textAlign: "center" }}>提案者</span>
          <span style={{ textAlign: "center" }}>クローザー</span>
          <span>活動量（提案/月・打合せ/週）</span>
          <span style={{ textAlign: "right" }}>アクション</span>
        </div>
        {rows.map((r) => {
          const isMe = myName && r.name === myName;
          const tone = r.kgiPct == null ? "warn" : r.kgiPct >= 80 ? "good" : r.kgiPct >= 50 ? "med" : "bad";
          // 背景：日報未提出が最優先(赤) → KGI未設定(橙) → 達成率低(薄赤) → 通常
          const bg = isMe ? "var(--color-brand-25)"
            : !r.reportYesterday ? "rgba(180,35,24,.06)"
            : tone === "bad" ? "rgba(180,35,24,.04)"
            : tone === "warn" ? "rgba(217,119,6,.04)"
            : "var(--color-surface)";
          return (
            <div key={r.name} style={{
              display: "grid", gridTemplateColumns: "minmax(130px, 180px) minmax(160px, 1.4fr) 60px 60px 1fr 110px", gap: 10,
              alignItems: "center", padding: "9px 10px",
              border: "1px solid var(--color-border)", borderRadius: 8, background: bg,
            }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 2, overflow: "hidden" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--color-ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {r.name}{isMe ? <span style={{ marginLeft: 6, fontSize: 10, color: "var(--color-brand-700)" }}>あなた</span> : null}
                  </span>
                  {!r.reportYesterday && (
                    <span title={`昨日(${yesterdayKey})の日報が未提出。最終提出: ${r.lastReportDate ?? "なし"}`}
                      style={{ fontSize: 9.5, fontWeight: 800, padding: "1px 7px", borderRadius: 99, background: "#fdecef", color: "#b42318", border: "1px solid #f7c5cf" }}>
                      📓 日報未提出
                    </span>
                  )}
                </div>
                <span className="muted" style={{ fontSize: 10.5 }}>
                  {r.department ?? "未所属"}{r.teamRole ? ` ・ ${labelOf(r.teamRole)}` : ""}
                  {r.lastReportDate && <> ・ 最終日報 {r.lastReportDate}</>}
                </span>
              </div>
              <KgiProgress placed={r.placedTotal} target={r.kgiTarget} pct={r.kgiPct} />
              <PlacedBadge value={r.placedAsProposer} tone="brand" />
              <PlacedBadge value={r.placedAsCloser} tone="accent" />
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <MiniBar label="提案" value={r.proposalsMonth} target={TARGET_PROPOSAL_MONTH} />
                <MiniBar label="打合せ" value={r.meetingsWeek} target={TARGET_MEETING_WEEK} />
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                {!isMe && (
                  <TeamMemberMessage recipient={r.name} hint={
                    !r.reportYesterday ? `📓 ${yesterdayKey} の日報が未提出です。リマインドを送りましょう。`
                      : r.kgiTarget == null ? "個人KGIが未設定です。1on1で目標を設定しましょう。"
                      : (r.kgiPct ?? 0) < 50 ? `KGI達成率が ${r.kgiPct}% と低めです。フォローのきっかけに。`
                      : undefined
                  } />
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="muted" style={{ fontSize: 11, marginTop: 10 }}>
        ※ KGI達成率＝今月の稼働化(提案者+クローザー合算) ÷ 個人月次KGI。日報未提出は <b>{yesterdayKey}</b>（直前営業日）基準。<b>KGI未設定の部下</b>は <a href="/settings/person-kgi" style={{ color: "var(--color-brand-700)" }}>個人KGI設定</a> から目標を設定してください。
      </div>
    </div>
  );
}

// 個人KGIの達成率バー。未設定はオレンジ警告。
function KgiProgress({ placed, target, pct }: { placed: number; target: number | null; pct: number | null }) {
  if (target == null) {
    return (
      <a href="/settings/person-kgi" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, color: "#b45309", textDecoration: "none" }}>
        ⚠ KGI未設定 <span style={{ fontSize: 10, textDecoration: "underline" }}>設定する →</span>
      </a>
    );
  }
  const color = pct! >= 80 ? "#067647" : pct! >= 50 ? "#b45309" : "#b42318";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ flex: 1, height: 8, borderRadius: 99, background: "var(--color-surface-inset)", overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, transition: "width .25s" }} />
      </div>
      <span className="mono" style={{ fontSize: 12, fontWeight: 800, color, minWidth: 50, textAlign: "right" }}>{placed}/{target}</span>
      <span style={{ fontSize: 10.5, fontWeight: 800, color, minWidth: 32, textAlign: "right" }}>{pct}%</span>
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
