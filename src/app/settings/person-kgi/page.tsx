// 個人月次KGI 設定画面。
//   admin: 全メンバーを編集可
//   manager/leader: 自部署メンバーのみ編集可
//   その他: アクセス不可

import { redirect } from "next/navigation";
import Link from "next/link";
import { currentAccess, listAccounts } from "@/lib/accounts";
import { canManageDept, DEPARTMENTS } from "@/lib/roles";
import { listPersonKgi, monthKey, planFromTarget } from "@/lib/person-kgi";
import { getFunnel, resolveFunnelPeriod, rate } from "@/lib/funnel";
import { PersonKgiEditor } from "@/components/PersonKgiEditor";

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

  // 既存KGI＋全社転換率（同月のものを使う想定で当月ファネル）
  const [kgis, funnel] = await Promise.all([
    listPersonKgi(month, { department }),
    (async () => {
      const { start, end, label } = resolveFunnelPeriod("this_month");
      return getFunnel(start, end, label);
    })(),
  ]);
  const conv = rate(funnel.total.won, funnel.total.proposal); // 提案→稼働化
  const kgiByEmail = new Map(kgis.map((k) => [k.owner_email, k] as const));

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
            マネージャーがメンバーごとに「今月の稼働化目標」を設定します。全社の総合転換率（提案→稼働化）から、月→週→日のKPIに自動逆算されます。
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

      <div className="card">
        <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 700 }}>👥 {department} メンバーの月次KGI</h3>
        {members.length === 0 ? (
          <div className="muted" style={{ fontSize: 12 }}>{department} に所属する active なメンバーがいません。</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {members.map((m) => {
              const existing = kgiByEmail.get(m.email);
              const plan = planFromTarget(existing?.placement_target ?? 0, conv, month);
              return (
                <PersonKgiEditor
                  key={m.email}
                  member={m}
                  month={month}
                  initial={existing ?? null}
                  conv={conv}
                  bizDays={plan.bizDays}
                />
              );
            })}
          </div>
        )}
        <div className="muted" style={{ fontSize: 11, marginTop: 12 }}>
          ※ 逆算式：月内必要提案数 = 稼働化目標 ÷ 全社転換率（{conv == null ? "—" : `${Math.round(conv * 100)}%`}）／週次 = ÷4.33／日次 = ÷月内営業日（{members.length > 0 ? planFromTarget(1, conv, month).bizDays : "—"}日）。
          転換率はファネル画面で更新されます。<Link href="/funnel" style={{ marginLeft: 4, color: "var(--color-brand-700)", textDecoration: "none" }}>ファネル →</Link>
        </div>
      </div>
    </div>
  );
}
