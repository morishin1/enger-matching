// 個人月次KGI 設定画面。
//   admin: 全メンバーを編集可
//   manager/leader: 自部署メンバーのみ編集可
//   その他: アクセス不可

import { redirect } from "next/navigation";
import Link from "next/link";
import { currentAccess, listAccounts } from "@/lib/accounts";
import { canManageDept, DEPARTMENTS } from "@/lib/roles";
import { listPersonKgi, monthKey, businessDaysInMonth } from "@/lib/person-kgi";
import { loadTeamGoal } from "@/lib/team-kgi-goals";
import { getFunnel, resolveFunnelPeriod, rate } from "@/lib/funnel";
import { KgiWorkspace } from "@/components/KgiWorkspace";

export const dynamic = "force-dynamic";

export default async function PersonKgiPage({ searchParams }: { searchParams: Promise<{ dept?: string; month?: string }> }) {
  const access = await currentAccess();
  const isAdmin = !access || access.role === "admin";
  const isManager = !!access && canManageDept(access.teamRole) && !!access.department;
  if (!isAdmin && !isManager) redirect("/settings");

  const sp = await searchParams;
  const month = sp.month && /^\d{4}-\d{2}-01$/.test(sp.month) ? sp.month : monthKey();
  const allowedDepts: readonly string[] = isAdmin ? DEPARTMENTS : [access!.department!];
  const department = (sp.dept && allowedDepts.includes(sp.dept)) ? sp.dept : allowedDepts[0];

  // 対象部署のメンバー一覧（active な agent/admin、氏名・メールあり）
  const allAccs = await listAccounts();
  const members = allAccs
    .filter((a) => a.status === "active" && (a.role === "agent" || a.role === "admin") && a.name && a.email)
    .filter((a) => (a as any).department === department)
    .map((a) => ({ email: a.email!.toLowerCase(), name: a.name!, teamRole: (a as any).team_role ?? null }));

  // 既存KGI＋チーム目標＋全社転換率（同月のものを使う想定で当月ファネル）
  const [kgis, teamGoal, funnel] = await Promise.all([
    listPersonKgi(month, { department }),
    loadTeamGoal(department, month),
    (async () => {
      const { start, end, label } = resolveFunnelPeriod("this_month");
      return getFunnel(start, end, label);
    })(),
  ]);
  const conv = rate(funnel.total.won, funnel.total.proposal); // 提案→稼働化
  const kgiByEmail = new Map(kgis.map((k) => [k.owner_email, k] as const));

  // メンバーごとの初期値（複数KPIの targets を含む）
  const initialPersons: Record<string, { targets: Record<string, number>; note: string | null; updated_at: string | null; updated_by_name: string | null }> = {};
  for (const m of members) {
    const k = kgiByEmail.get(m.email);
    initialPersons[m.email] = k
      ? { targets: k.targets ?? {}, note: k.note, updated_at: k.updated_at, updated_by_name: k.updated_by_name }
      : { targets: {}, note: null, updated_at: null, updated_by_name: null };
  }
  const bizDays = businessDaysInMonth(month);

  // 月セレクタ
  const months: { key: string; label: string }[] = [];
  const base = new Date();
  base.setDate(1);
  for (let i = -3; i <= 3; i++) {
    const d = new Date(base.getFullYear(), base.getMonth() + i, 1);
    months.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`, label: `${d.getFullYear()}年${d.getMonth() + 1}月` });
  }

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ maxWidth: 760 }}>
          <div className="meta">Settings · 個人KGI</div>
          <h1>個人月次KGI 設定</h1>
          <div className="sub">
            まず<b>チーム目標</b>（部署全体のKPI）を入力し、「メンバーへ均等配分」で各メンバーへKPIとして割り当てます。項目は稼働化・提案・架電などから複数追加でき、カスタム項目も作れます。稼働化は全社転換率から月→週→日の提案数に自動逆算されます。
            {isManager && !isAdmin && <> あなたは <b>{access?.department}</b> の {access?.teamRole === "manager" ? "マネージャー" : "リーダー"} です。</>}
          </div>
        </div>
        <Link href="/settings" className="btn ghost" style={{ textDecoration: "none", alignSelf: "flex-start" }}>← 設定へ戻る</Link>
      </div>

      <div className="card" style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center" }}>
        <div>
          <div className="meta" style={{ marginBottom: 6 }}>部署</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {allowedDepts.map((d) => {
              const on = d === department;
              return (
                <Link key={d} href={`/settings/person-kgi?dept=${encodeURIComponent(d)}&month=${month}`} style={{
                  fontSize: 12, padding: "5px 12px", borderRadius: 99, textDecoration: "none",
                  border: `1px solid ${on ? "var(--color-brand-600)" : "var(--color-border)"}`,
                  background: on ? "var(--color-brand-600)" : "var(--color-surface)",
                  color: on ? "#fff" : "var(--color-ink-2)", fontWeight: on ? 700 : 600,
                }}>{d}</Link>
              );
            })}
          </div>
        </div>
        <div>
          <div className="meta" style={{ marginBottom: 6 }}>対象月</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {months.map((m) => {
              const on = m.key === month;
              return (
                <Link key={m.key} href={`/settings/person-kgi?dept=${encodeURIComponent(department)}&month=${m.key}`} style={{
                  fontSize: 12, padding: "5px 12px", borderRadius: 99, textDecoration: "none",
                  border: `1px solid ${on ? "var(--color-brand-600)" : "var(--color-border)"}`,
                  background: on ? "var(--color-brand-600)" : "var(--color-surface)",
                  color: on ? "#fff" : "var(--color-ink-2)", fontWeight: on ? 700 : 600,
                }}>{m.label}</Link>
              );
            })}
          </div>
        </div>
        <div style={{ marginLeft: "auto", padding: "6px 14px", borderRadius: 10, background: "var(--color-brand-25)", border: "1px solid var(--color-brand-100)", fontSize: 12 }}>
          全社転換率（提案→稼働化）<b className="mono" style={{ marginLeft: 6, color: "var(--color-brand-700)", fontSize: 14 }}>{conv == null ? "—" : `${Math.round(conv * 100)}%`}</b>
        </div>
      </div>

      <KgiWorkspace
        department={department}
        month={month}
        members={members}
        conv={conv}
        bizDays={bizDays}
        initialTeamGoal={teamGoal}
        initialPersons={initialPersons}
      />

      <div className="muted" style={{ fontSize: 11 }}>
        ※ 逆算式：月内必要提案数 = 稼働化目標 ÷ 全社転換率（{conv == null ? "—" : `${Math.round(conv * 100)}%`}）／週次 = ÷4.33／日次 = ÷月内営業日（{bizDays}日）。
        転換率はファネル画面で更新されます。<Link href="/funnel" style={{ marginLeft: 4, color: "var(--color-brand-700)", textDecoration: "none" }}>ファネル →</Link>
      </div>
    </div>
  );
}
