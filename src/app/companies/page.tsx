import { Icons } from "@/components/icons";
import { CompaniesView } from "@/components/CompaniesView";
import { getCompanyOverview } from "@/lib/companies";
import { dbConfigured } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function CompaniesPage() {
  const companies = (await getCompanyOverview()) ?? [];
  const needSetup = dbConfigured && companies.length === 0;

  const total = companies.length;
  const tierA = companies.filter((c) => c.tier === "A").length;
  const activeTotal = companies.reduce((a, c) => a + (c.active_jobs ?? 0), 0);
  const focusTotal = companies.reduce((a, c) => a + (c.focus_jobs ?? 0), 0);
  const dormant = companies.filter((c) => c.status === "休眠").length;
  const newCount = companies.filter((c) => c.status === "新規").length;

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ maxWidth: 820 }}>
          <div className="meta">Companies · 取引先（案件データから集約）</div>
          <h1>企業管理</h1>
          <div className="sub">
            取引先 <b style={{ color: "var(--color-ink)" }}>{total.toLocaleString("ja-JP")} 社</b> · 進行中案件 <b style={{ color: "var(--color-ink)" }}>{activeTotal.toLocaleString("ja-JP")} 件</b>。
            実在案件のクライアント名から自動集約し、案件数でA/B/Cを推定しています。
          </div>
        </div>
      </div>

      {needSetup && (
        <div className="card" style={{ background: "var(--color-brand-25)", borderColor: "var(--color-brand-100)" }}>
          <b>集計関数が未作成です。</b> SQL Editor で <span className="mono">supabase/companies-rpc.sql</span> を実行すると、案件のクライアント名から企業一覧が表示されます。
        </div>
      )}

      <div className="kpi-grid">
        <div className="kpi brand">
          <div className="top"><div className="ico-box"><Icons.company /></div><div className="chip flat">{tierA}社 / A</div></div>
          <div><div className="val tnum">{total.toLocaleString("ja-JP")}<span className="unit">社</span></div><div className="label">取引先 全数</div><div className="note">{newCount} 新規 · {dormant} 休眠</div></div>
        </div>
        <div className="kpi">
          <div className="top"><div className="ico-box"><Icons.jobs /></div><div className="chip">募集中</div></div>
          <div><div className="val tnum">{activeTotal.toLocaleString("ja-JP")}<span className="unit">件</span></div><div className="label">進行中案件</div><div className="note">{total} 社合計</div></div>
        </div>
        <div className="kpi accent">
          <div className="top"><div className="ico-box"><Icons.star /></div><div className="chip">♥</div></div>
          <div><div className="val tnum">{focusTotal.toLocaleString("ja-JP")}<span className="unit">件</span></div><div className="label">注力案件</div><div className="note">企業横断</div></div>
        </div>
        <div className="kpi warn">
          <div className="top"><div className="ico-box"><Icons.bolt /></div><div className="chip">休眠</div></div>
          <div><div className="val tnum">{dormant.toLocaleString("ja-JP")}<span className="unit">社</span></div><div className="label">休眠（90日超）</div><div className="note">再アプローチ候補</div></div>
        </div>
      </div>

      {!needSetup && <CompaniesView companies={companies} />}
    </div>
  );
}
