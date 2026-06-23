// チームKGI設定（管理者・マネージャー/リーダー専用）。
//   - admin: 全部署のKGIを月ごとに編集可能
//   - manager/leader: 自部署のKGIのみ編集可能
//   - それ以外: アクセス不可（リダイレクト）

import { redirect } from "next/navigation";
import Link from "@/components/AppLink";
import { currentAccess } from "@/lib/accounts";
import { canManageDept, DEPARTMENTS } from "@/lib/roles";
import { getTeamKgi, currentMonthKey } from "@/lib/team-kgi";
import { TeamKgiEditor } from "@/components/TeamKgiEditor";

export const dynamic = "force-dynamic";

export default async function TeamKgiPage({ searchParams }: { searchParams: Promise<{ dept?: string; month?: string }> }) {
  const access = await currentAccess();
  const isAdmin = !access || access.role === "admin"; // ローカル(未認証)=admin相当
  const isManager = !!access && canManageDept(access.teamRole) && !!access.department;

  if (!isAdmin && !isManager) {
    // 権限がない人は設定トップに戻す
    redirect("/settings");
  }

  const sp = await searchParams;
  // admin は全部署から選択。manager/leader は自部署固定。
  const allowedDepts: readonly string[] = isAdmin ? DEPARTMENTS : [access!.department!];
  const department = (sp.dept && allowedDepts.includes(sp.dept)) ? sp.dept : allowedDepts[0];
  const month = sp.month && /^\d{4}-\d{2}-01$/.test(sp.month) ? sp.month : currentMonthKey();

  const kgi = await getTeamKgi(department, month);

  // 月セレクタ用：直近6ヶ月＋翌3ヶ月
  const months: { key: string; label: string }[] = [];
  const base = new Date();
  base.setDate(1);
  for (let i = -6; i <= 3; i++) {
    const d = new Date(base.getFullYear(), base.getMonth() + i, 1);
    months.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`,
      label: `${d.getFullYear()}年${d.getMonth() + 1}月`,
    });
  }

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ maxWidth: 760 }}>
          <div className="meta">Settings · チームKGI</div>
          <h1>チームKGI 設定</h1>
          <div className="sub">
            稼働数を中心にチーム（部署）の月次KGIを設定します。「今の稼働から何名増やすか」を決めると、売上・利益が自動で紐づいて算出されます（目標稼働数 × 1名あたり平均月額／粗利）。
            {isManager && !isAdmin && <> あなたは <b>{access?.department}</b> の {access?.teamRole === "manager" ? "マネージャー" : "リーダー"} です。</>}
          </div>
        </div>
        <Link href="/settings" className="btn ghost" style={{ textDecoration: "none", alignSelf: "flex-start" }}>← 設定へ戻る</Link>
      </div>

      {/* 選択フォーム（部署・月）。リンクで切替（軽量）。 */}
      <div className="card" style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center" }}>
        <div>
          <div className="meta" style={{ marginBottom: 6 }}>部署（チーム）</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {allowedDepts.map((d) => {
              const on = d === department;
              return (
                <Link key={d} href={`/settings/team-kgi?dept=${encodeURIComponent(d)}&month=${month}`} style={{
                  fontFamily: "inherit", fontSize: 12, padding: "5px 12px", borderRadius: 99, textDecoration: "none",
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
                <Link key={m.key} href={`/settings/team-kgi?dept=${encodeURIComponent(department)}&month=${m.key}`} style={{
                  fontFamily: "inherit", fontSize: 12, padding: "5px 12px", borderRadius: 99, textDecoration: "none",
                  border: `1px solid ${on ? "var(--color-brand-600)" : "var(--color-border)"}`,
                  background: on ? "var(--color-brand-600)" : "var(--color-surface)",
                  color: on ? "#fff" : "var(--color-ink-2)", fontWeight: on ? 700 : 600,
                }}>{m.label}</Link>
              );
            })}
          </div>
        </div>
      </div>

      <TeamKgiEditor department={department} month={month} initial={kgi} />
    </div>
  );
}
