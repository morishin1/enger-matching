// 管理者ダッシュボード本体（1画面構成 / KGI・KPI・課題→次アクション・メンバー進捗・日報）。
//   設計意図：
//     - スクロール最小：縦の積みを抑え、3段構成で見える。
//     - "課題と次のアクション" を最上段に持ち上げ、ボトルネック→誰に話すかが分かる。
//     - 既存の重いセクション（成長ボード/取引構造/コスト/活動/受信箱/自分のKPI）は /insights に退避。

import Link from "next/link";
import { engerAdmin, engerClient, dbConfigured } from "@/lib/supabase";
import { listAccounts } from "@/lib/accounts";
import { DEPARTMENTS } from "@/lib/roles";
import { currentMonthKey, projectKgi, type TeamKgi } from "@/lib/team-kgi";
import { listPersonKgi, planFromTarget } from "@/lib/person-kgi";
import { getFunnel, resolveFunnelPeriod, rate } from "@/lib/funnel";
import { getBounceSummary } from "@/lib/bounces";

type Account = { name: string; email: string | null; department: string | null; teamRole: string | null; role: string };
type Issue = { tone: "danger" | "warn"; icon: string; title: string; detail: string; action: string; href?: string };

const STALE_DAYS = 7;                    // 滞留商談のしきい値
const RENEWAL_SOON_DAYS = 30;            // 離脱予兆：契約終了が近い日数
// 進行中ステージ。新名(所属確認/提案中/面談/合格)＋旧名を互換のため両方含める。
const ACTIVE_PROP_STAGES = ["所属確認", "提案中", "面談", "合格", "提案済", "返信待ち", "面談調整", "クロージング中", "面談合格"]; // 滞留判定対象

// 業務日（昨日。土日なら直近の金曜）
function lastBusinessDay(today = new Date()): string {
  const d = new Date(today);
  d.setDate(d.getDate() - 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

const fmtMan = (man: number) => (man >= 10000 ? `${(man / 10000).toFixed(1)}億円` : `${Math.round(man).toLocaleString("ja-JP")}万円`);

export async function AdminOverview() {
  if (!dbConfigured) {
    return (
      <div className="page">
        <div className="card" style={{ padding: 16 }}>
          <div className="muted" style={{ fontSize: 12 }}>DB未接続のため、サマリーは表示できません。</div>
        </div>
      </div>
    );
  }

  let sb: ReturnType<typeof engerClient>;
  try { sb = engerAdmin(); } catch { sb = engerClient(); }

  const now = new Date();
  const month = currentMonthKey(now);
  const monthStartIso = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const monthPrefix = now.toISOString().slice(0, 7);
  const yesterday = lastBusinessDay(now);
  const staleBefore = new Date(Date.now() - STALE_DAYS * 86400000).toISOString();
  const renewalDeadline = new Date(Date.now() + RENEWAL_SOON_DAYS * 86400000).toISOString().slice(0, 10);

  // ---- まとめてフェッチ（同列パラレル） ----
  const [accs, kgiRes, engAllRes, engMonthRes, propMonthRes, propStaleRes, dailyRecentRes, dailyYesterdayRes] = await Promise.all([
    listAccounts(),
    sb.from("team_kgi").select("department, month, active_current, active_add, rate_per_head_man, gross_per_head_man, dropout_allowed").eq("month", month),
    sb.from("engagements").select("id, status, end_date, renewal_status").limit(2000),
    sb.from("engagements").select("proposal_id, created_at").gte("created_at", monthStartIso).limit(2000),
    sb.from("proposals").select("proposer, closer, created_at").gte("created_at", monthStartIso).limit(3000),
    sb.from("proposals").select("id, stage, updated_at").in("stage", ACTIVE_PROP_STAGES as any).lt("updated_at", staleBefore).limit(500),
    sb.from("daily_reports").select("author, team, report_date, learned, next_action, good, problem, mood, created_at").order("report_date", { ascending: false }).order("created_at", { ascending: false }).limit(5),
    sb.from("daily_reports").select("author").eq("report_date", yesterday),
  ]);

  const members: Account[] = accs
    .filter((a) => a.status === "active" && (a.role === "admin" || a.role === "agent") && a.name)
    .map((a) => ({ name: a.name!, email: (a.email ?? null), department: (a as any).department ?? null, teamRole: (a as any).team_role ?? null, role: a.role }));

  const kgis: TeamKgi[] = ((kgiRes.data ?? []) as any[]);
  const kgiByDept = new Map<string, TeamKgi>(kgis.map((k) => [k.department, k] as const));

  // 個人KGI（当月）＋全社転換率（提案→稼働化）＋メール送達状況（bounce_records）。
  const [personKgis, convThisMonth, bounceSummary] = await Promise.all([
    listPersonKgi(month),
    (async () => {
      const { start, end, label } = resolveFunnelPeriod("this_month", now);
      const f = await getFunnel(start, end, label);
      return rate(f.total.won, f.total.proposal);
    })(),
    getBounceSummary(5),
  ]);
  const personKgiByEmail = new Map(personKgis.map((k) => [k.owner_email, k] as const));

  // 全社KGI 合算
  const sumKgi = kgis.reduce((s, k) => ({
    cur: s.cur + (k.active_current ?? 0),
    add: s.add + (k.active_add ?? 0),
    grossMan: s.grossMan + ((k.active_current ?? 0) + (k.active_add ?? 0)) * (k.gross_per_head_man ?? 0),
    revMan: s.revMan + ((k.active_current ?? 0) + (k.active_add ?? 0)) * (k.rate_per_head_man ?? 0),
    drop: s.drop + (k.dropout_allowed ?? 0),
  }), { cur: 0, add: 0, grossMan: 0, revMan: 0, drop: 0 });
  const totalTarget = sumKgi.cur + sumKgi.add;

  // 現在の稼働中件数（実績）
  const engAll = (engAllRes.data ?? []) as any[];
  const activeNow = engAll.filter((e) => e.status === "稼働中" || e.status == null || e.status === "予定").length;

  // 今月の稼働化件数（実績）
  const monthEngs = (engMonthRes.data ?? []) as any[];
  const placedTotal = monthEngs.length;

  // 稼働化を「提案者の部署」「クロージング担当の部署」へ案分（案D：両方カウント）
  const propMap = new Map<string, { proposer: string | null; closer: string | null }>();
  if (monthEngs.length > 0) {
    const ids = Array.from(new Set(monthEngs.map((e) => e.proposal_id).filter(Boolean)));
    if (ids.length > 0) {
      const pr = await sb.from("proposals").select("id, proposer, closer").in("id", ids).limit(3000);
      for (const p of (pr.data ?? []) as any[]) propMap.set(p.id, { proposer: p.proposer ?? null, closer: p.closer ?? null });
    }
  }
  const deptByName = new Map<string, string | null>(members.map((m) => [m.name, m.department]));
  const placedByDept = new Map<string, number>();
  const placedAsProposerByName = new Map<string, number>();
  const placedAsCloserByName = new Map<string, number>();
  for (const e of monthEngs) {
    const p = propMap.get(e.proposal_id);
    if (!p) continue;
    const bump = (dept: string | null | undefined) => { if (!dept) return; placedByDept.set(dept, (placedByDept.get(dept) ?? 0) + 1); };
    if (p.proposer) { placedAsProposerByName.set(p.proposer, (placedAsProposerByName.get(p.proposer) ?? 0) + 1); bump(deptByName.get(p.proposer) ?? null); }
    if (p.closer)   { placedAsCloserByName.set(p.closer,   (placedAsCloserByName.get(p.closer)   ?? 0) + 1); bump(deptByName.get(p.closer)   ?? null); }
  }

  // 提案数（今月）
  const propsMonth = (propMonthRes.data ?? []) as any[];
  const proposalsByName = new Map<string, number>();
  for (const p of propsMonth) {
    if (!p.proposer) continue;
    if (String(p.created_at ?? "").slice(0, 7) !== monthPrefix) continue;
    proposalsByName.set(p.proposer, (proposalsByName.get(p.proposer) ?? 0) + 1);
  }

  // 日報未提出メンバー（昨日分・営業職能のいる admin/agent）
  const reportedYesterday = new Set<string>(((dailyYesterdayRes.data ?? []) as any[]).map((r) => r.author));
  const missingDaily = members.filter((m) => !reportedYesterday.has(m.name));

  // 滞留商談
  const staleCount = (propStaleRes.data ?? []).length;

  // 離脱予兆：稼働中で end_date が近い、または renewal_status が終了予定/打診中
  const nearEnd = engAll.filter((e) => {
    if (e.status === "終了") return false;
    if (e.renewal_status === "終了予定") return true;
    if (e.end_date && String(e.end_date) <= renewalDeadline) return true;
    return false;
  }).length;

  // 部署別の稼働化目標未達
  const underperformingDepts: { dept: string; target: number; actual: number; gap: number }[] = [];
  for (const d of DEPARTMENTS) {
    const k = kgiByDept.get(d);
    if (!k || k.active_add == null || k.active_add <= 0) continue;
    const actual = placedByDept.get(d) ?? 0;
    const gap = (k.active_add ?? 0) - actual;
    if (gap > 0) underperformingDepts.push({ dept: d, target: k.active_add ?? 0, actual, gap });
  }
  underperformingDepts.sort((a, b) => b.gap - a.gap);

  // KGI/KPI 未設定のメンバー（当月）。個人KGI(person_kgi.placement_target)が無い人を抽出。
  //   ・対象：active な agent/admin（営業メンバー）で email を持つ人
  //   ・KGIを決めれば planFromTarget で日/週/月の提案KPIが自動で出る → 進捗管理可能
  const kgiTargets = members.filter((m) => m.email && m.role === "agent"); // 営業エージェントが対象
  const membersWithoutKgi = kgiTargets.filter((m) => {
    const k = personKgiByEmail.get((m.email as string).toLowerCase());
    return !k || k.placement_target == null || k.placement_target <= 0;
  });
  const deptsWithoutTeamKgi = DEPARTMENTS.filter((d) => {
    const k = kgiByDept.get(d);
    return !k || ((k.active_add == null || k.active_add <= 0) && (k.active_current == null || k.active_current <= 0));
  });

  // ---- 課題と次のアクション（最大4枚） ----
  const issues: Issue[] = [];
  // KGI未設定は「土台」なので最優先で出す（決めれば以降すべての進捗管理が回る）
  if (membersWithoutKgi.length > 0) {
    const names = membersWithoutKgi.slice(0, 3).map((m) => m.name).join("、");
    issues.push({
      tone: membersWithoutKgi.length >= 3 ? "danger" : "warn", icon: "🎯",
      title: `個人KGI未設定 ${membersWithoutKgi.length}名`,
      detail: `${names}${membersWithoutKgi.length > 3 ? ` 他${membersWithoutKgi.length - 3}名` : ""} の今月の稼働化目標が未設定（提案KPIも逆算されません）`,
      action: "個人KGIを設定", href: "/settings/person-kgi",
    });
  } else if (deptsWithoutTeamKgi.length > 0) {
    issues.push({
      tone: "warn", icon: "🎯",
      title: `部署KGI未設定 ${deptsWithoutTeamKgi.length}部署`,
      detail: `${deptsWithoutTeamKgi.join("、")} の今月の稼働数・稼働化目標が未設定`,
      action: "部署KGIを設定", href: "/settings/team-kgi",
    });
  }
  if (underperformingDepts.length > 0) {
    const top = underperformingDepts[0];
    const others = underperformingDepts.length - 1;
    issues.push({
      tone: "danger", icon: "⚠️",
      title: `${top.dept} の稼働化が目標未達`,
      detail: `目標+${top.target}名 → 実績 ${top.actual}名（残り ${top.gap}名）${others > 0 ? ` ・他${others}部署` : ""}`,
      action: "リーダーと優先候補をすり合わせ", href: "/settings/team-kgi",
    });
  }
  if (missingDaily.length > 0) {
    const names = missingDaily.slice(0, 3).map((m) => m.name).join("、");
    issues.push({
      tone: missingDaily.length >= 3 ? "danger" : "warn", icon: "📝",
      title: `日報 未提出 ${missingDaily.length}名（${yesterday}）`,
      detail: `${names}${missingDaily.length > 3 ? ` 他${missingDaily.length - 3}名` : ""}`,
      action: "リマインドを送る", href: "/reports",
    });
  }
  if (staleCount > 0) {
    issues.push({
      tone: staleCount >= 10 ? "danger" : "warn", icon: "⏳",
      title: `滞留している商談 ${staleCount}件`,
      detail: `${STALE_DAYS}日以上動きのない提案・面談調整・クロージング`,
      action: "次アクションを設定", href: "/proposals",
    });
  }
  if (nearEnd > 0) {
    issues.push({
      tone: nearEnd >= 3 ? "danger" : "warn", icon: "🚪",
      title: `離脱予兆の稼働 ${nearEnd}件`,
      detail: `契約終了 ${RENEWAL_SOON_DAYS}日以内・更新打診待ち`,
      action: "更新フォロー", href: "/engagements",
    });
  }
  if (bounceSummary.available && bounceSummary.uniqueRecipients > 0) {
    const topNames = bounceSummary.top.slice(0, 3).map((b) => b.recipient_email.split("@")[1] ?? b.recipient_email).join("、");
    issues.push({
      tone: bounceSummary.uniqueRecipients >= 5 ? "danger" : "warn", icon: "📭",
      title: `送達不能 ${bounceSummary.uniqueRecipients}件（提案メール不達）`,
      detail: `不達アドレス ${bounceSummary.uniqueRecipients}件・累計 ${bounceSummary.total}回。${topNames ? `多発: ${topNames}` : ""} 提案前に正しい連絡先を確認してください。`,
      action: "宛先を確認", href: "/mail",
    });
  }
  // 課題がゼロのとき：祝意セルを1枚出す
  if (issues.length === 0) {
    issues.push({
      tone: "warn", icon: "✅",
      title: "課題は検知されていません",
      detail: "全部署が目標ペースで進行中。離脱予兆や滞留商談も無し。",
      action: "次の目標に着手", href: "/settings/team-kgi",
    });
  }
  const shownIssues = issues.slice(0, 4);

  // ---- メンバー進捗（コンパクト） ----
  //   KGI(=個人の月次稼働化目標)があれば「実績/目標」と日次提案KPIを併記して進捗管理できるようにする。
  type MemberRow = {
    name: string; department: string | null; isAgent: boolean; placedTotal: number; placedProp: number; placedClose: number; proposals: number;
    kgiTarget: number | null; dailyProposalTarget: number | null; hasKgi: boolean;
  };
  const rows: MemberRow[] = members.map((m) => {
    const pp = placedAsProposerByName.get(m.name) ?? 0;
    const pc = placedAsCloserByName.get(m.name) ?? 0;
    const isAgent = m.role === "agent";
    const k = m.email ? personKgiByEmail.get((m.email).toLowerCase()) : undefined;
    const kgiTarget = isAgent ? (k?.placement_target ?? null) : null; // 個人KGIは営業エージェントのみ評価
    const plan = kgiTarget && convThisMonth ? planFromTarget(kgiTarget, convThisMonth, month) : null;
    return {
      name: m.name, department: m.department, isAgent, placedTotal: pp + pc, placedProp: pp, placedClose: pc,
      proposals: proposalsByName.get(m.name) ?? 0,
      kgiTarget, dailyProposalTarget: plan?.dailyProposals ?? null, hasKgi: kgiTarget != null && kgiTarget > 0,
    };
  });
  // KGI未設定のエージェントを上に出して「決める」を促す。その次に実績順。
  rows.sort((a, b) => (Number(!a.isAgent) - Number(!b.isAgent)) || (Number(a.hasKgi) - Number(b.hasKgi)) || (b.placedTotal - a.placedTotal) || (b.proposals - a.proposals));
  const topRows = rows.slice(0, 12); // 上位12名（スクロール抑制）

  // ---- 日報（最新5件） ----
  const dailies = ((dailyRecentRes.data ?? []) as any[]).slice(0, 5);

  const proj = projectKgi({ active_current: sumKgi.cur, active_add: sumKgi.add, rate_per_head_man: 0, gross_per_head_man: 0 });
  const placementProgress = totalTarget > 0 ? Math.min(100, Math.round((placedTotal / Math.max(1, sumKgi.add)) * 100)) : 0;

  return (
    <div className="page" style={{ paddingTop: 16 }}>
      {/* 上段：全社KGI 4タイル */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginBottom: 14 }}>
        <KgiTile
          label="🎯 全社 稼働数"
          big={`${activeNow}`} unit="名"
          sub={`目標 ${proj.target}名（現+${sumKgi.add}）`}
          pctLabel={totalTarget > 0 ? `${Math.round(activeNow / proj.target * 100)}%` : "—"}
          pct={totalTarget > 0 ? Math.min(100, Math.round(activeNow / proj.target * 100)) : 0}
          tone="brand"
        />
        <KgiTile
          label="📈 今月の稼働化"
          big={`${placedTotal}`} unit="件"
          sub={`目標 +${sumKgi.add}名`}
          pctLabel={sumKgi.add > 0 ? `${placementProgress}%` : "—"}
          pct={placementProgress}
          tone="accent"
        />
        <KgiTile
          label="💴 月間粗利見込み"
          big={fmtMan(sumKgi.grossMan)} unit=""
          sub={`売上見込 ${fmtMan(sumKgi.revMan)}`}
        />
        <KgiTile
          label="🚪 離脱予兆"
          big={`${nearEnd}`} unit="件"
          sub={`許容離脱 ${sumKgi.drop} 名 / 月`}
          tone={nearEnd >= 3 ? "danger" : "neutral"}
        />
      </div>

      {/* 中段：課題と次のアクション */}
      <div className="card" style={{ padding: 12, marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <h3 style={{ margin: 0, fontSize: 13, fontWeight: 800 }}>🚨 課題と次のアクション</h3>
          <span className="muted" style={{ fontSize: 11 }}>ボトルネックから先に潰す</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 10 }}>
          {shownIssues.map((iss, i) => (
            <IssueCard key={i} {...iss} />
          ))}
        </div>
      </div>

      {/* 下段：2カラム（メンバー進捗 / 今日の日報） */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(320px, 1.5fr) minmax(280px, 1fr)", gap: 14, alignItems: "start" }}>
        {/* メンバー進捗（コンパクト） */}
        <div className="card" style={{ padding: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, gap: 8, flexWrap: "wrap" }}>
            <h3 style={{ margin: 0, fontSize: 13, fontWeight: 800 }}>👥 メンバー進捗（今月）</h3>
            <Link href="/settings/person-kgi" style={{ fontSize: 11, color: "var(--color-brand-700)", textDecoration: "none" }}>🎯 個人KGI設定 →</Link>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(96px, 1.4fr) 54px 54px minmax(96px, 1.3fr) 58px", gap: 8, padding: "4px 8px", fontSize: 10, fontWeight: 700, color: "var(--color-ink-4)" }}>
              <span>メンバー</span><span style={{ textAlign: "center" }}>提案者</span><span style={{ textAlign: "center" }}>クローザー</span><span>稼働化 / KGI</span><span style={{ textAlign: "center" }} title="日次の提案目標（KGIから逆算）">提案/日目標</span>
            </div>
            {topRows.length === 0 && <div className="muted" style={{ fontSize: 12, padding: 8 }}>メンバーがいません</div>}
            {topRows.map((r) => (
              <div key={r.name} style={{ display: "grid", gridTemplateColumns: "minmax(96px, 1.4fr) 54px 54px minmax(96px, 1.3fr) 58px", gap: 8, alignItems: "center", padding: "5px 8px", borderRadius: 6, background: r.isAgent && !r.hasKgi ? "rgba(217,119,6,.05)" : "var(--color-surface)" }}>
                <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  <span style={{ fontSize: 12, fontWeight: 700 }}>{r.name}</span>
                  {r.department && <span className="muted" style={{ fontSize: 10, marginLeft: 6 }}>{r.department}</span>}
                </div>
                <NumPill value={r.placedProp} tone="brand" />
                <NumPill value={r.placedClose} tone="accent" />
                {r.isAgent
                  ? <KgiProgress placed={r.placedTotal} target={r.kgiTarget} />
                  : <span className="muted" style={{ fontSize: 11, textAlign: "center" }}>—</span>}
                {!r.isAgent
                  ? <span className="muted" style={{ textAlign: "center", fontSize: 11 }}>—</span>
                  : r.dailyProposalTarget != null
                    ? <span style={{ textAlign: "center", fontSize: 11.5, fontWeight: 800, color: "var(--color-brand-700)" }}>{r.dailyProposalTarget}件</span>
                    : <Link href="/settings/person-kgi" title="個人KGI未設定。クリックして設定" style={{ textAlign: "center", fontSize: 10, fontWeight: 700, color: "#b45309", textDecoration: "none" }}>未設定</Link>}
              </div>
            ))}
          </div>
        </div>

        {/* 今日の日報 */}
        <div className="card" style={{ padding: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <h3 style={{ margin: 0, fontSize: 13, fontWeight: 800 }}>📝 最新の日報</h3>
            <Link href="/reports" style={{ fontSize: 11, color: "var(--color-brand-700)", textDecoration: "none" }}>すべて見る →</Link>
          </div>
          {dailies.length === 0 && <div className="muted" style={{ fontSize: 12, padding: 8 }}>日報がありません</div>}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {dailies.map((d, i) => (
              <div key={i} style={{ padding: "8px 10px", border: "1px solid var(--color-border)", borderRadius: 8, background: "var(--color-surface)" }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 3 }}>
                  <span style={{ fontSize: 12, fontWeight: 700 }}>{d.author}</span>
                  {d.mood && <span style={{ fontSize: 12 }}>{d.mood}</span>}
                  <span className="muted" style={{ fontSize: 10 }}>{d.report_date}</span>
                </div>
                {(d.problem || d.learned) && (
                  <div style={{ fontSize: 11.5, color: "var(--color-ink-2)", overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const }}>
                    {d.problem || d.learned}
                  </div>
                )}
                {d.next_action && (
                  <div style={{ fontSize: 11, color: "var(--color-brand-700)", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    → {d.next_action}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 詳細導線 */}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <Link href="/funnel" className="btn ghost btn-xs" style={{ textDecoration: "none" }}>🔁 ファネル（転換率）→</Link>
        <Link href="/insights" className="btn ghost btn-xs" style={{ textDecoration: "none" }}>📊 詳細インサイト（成長ボード・コスト・取引構造） →</Link>
      </div>
    </div>
  );
}

function KgiTile({ label, big, unit, sub, pct, pctLabel, tone }: { label: string; big: string; unit?: string; sub?: string; pct?: number; pctLabel?: string; tone?: "brand" | "accent" | "danger" | "neutral" }) {
  const color = tone === "danger" ? "var(--color-danger)" : tone === "accent" ? "#067647" : tone === "brand" ? "var(--color-brand-700)" : "var(--color-ink)";
  const bg = tone === "brand" ? "var(--color-brand-25)" : tone === "accent" ? "rgba(6,118,71,.06)" : tone === "danger" ? "rgba(217,45,32,.06)" : "var(--color-surface)";
  return (
    <div style={{ padding: 14, borderRadius: 12, border: "1px solid var(--color-border)", background: bg }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--color-ink-3)", marginBottom: 6 }}>{label}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginBottom: 4 }}>
        <span className="mono" style={{ fontSize: 26, fontWeight: 800, color, lineHeight: 1 }}>{big}</span>
        {unit && <span style={{ fontSize: 12, color: "var(--color-ink-3)" }}>{unit}</span>}
        {pctLabel && <span className="mono" style={{ marginLeft: "auto", fontSize: 11, fontWeight: 700, color }}>{pctLabel}</span>}
      </div>
      {sub && <div className="muted" style={{ fontSize: 11 }}>{sub}</div>}
      {pct != null && (
        <div style={{ height: 4, borderRadius: 99, background: "var(--color-surface-inset)", overflow: "hidden", marginTop: 8 }}>
          <div style={{ width: `${pct}%`, height: "100%", background: color, transition: "width .25s" }} />
        </div>
      )}
    </div>
  );
}

function IssueCard({ tone, icon, title, detail, action, href }: Issue) {
  const border = tone === "danger" ? "var(--color-danger)" : "#d97706";
  const bg = tone === "danger" ? "rgba(217,45,32,.05)" : "rgba(217,119,6,.06)";
  const body = (
    <div style={{ padding: 12, borderRadius: 10, border: `1px solid ${border}`, background: bg, height: "100%", display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 14 }}>{icon}</span>
        <span style={{ fontSize: 12.5, fontWeight: 800, color: "var(--color-ink)" }}>{title}</span>
      </div>
      <div className="muted" style={{ fontSize: 11, lineHeight: 1.5 }}>{detail}</div>
      <div style={{ marginTop: "auto", paddingTop: 4, fontSize: 11.5, fontWeight: 700, color: border }}>→ {action}</div>
    </div>
  );
  return href ? <Link href={href} style={{ textDecoration: "none" }}>{body}</Link> : body;
}

function NumPill({ value, tone }: { value: number; tone: "brand" | "accent" }) {
  const on = value > 0;
  const color = tone === "brand" ? "var(--color-brand-700)" : "#067647";
  return (
    <span className="mono" style={{ fontSize: 14, fontWeight: 800, color: on ? color : "var(--color-ink-4)", textAlign: "center" }}>{value}</span>
  );
}

// 稼働化の対KGI進捗バー。target未設定なら「KGI未設定」を出す。
function KgiProgress({ placed, target }: { placed: number; target: number | null }) {
  if (target == null || target <= 0) {
    return <span style={{ fontSize: 10, color: "#b45309", fontWeight: 700 }}>KGI未設定</span>;
  }
  const pct = Math.min(100, Math.round((placed / target) * 100));
  const done = placed >= target;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ flex: 1, height: 4, borderRadius: 99, background: "var(--color-surface-inset)", overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: done ? "#1aa260" : "#067647", transition: "width .25s" }} />
      </div>
      <span className="mono" style={{ fontSize: 10.5, color: done ? "#067647" : "var(--color-ink-3)", width: 32, textAlign: "right" }}>{placed}/{target}</span>
    </div>
  );
}
