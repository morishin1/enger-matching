import { CompaniesView } from "@/components/CompaniesView";
import { CompanyCsv } from "@/components/CompanyCsv";
import { CompanyFollowups, type FollowupRow } from "@/components/CompanyFollowups";
import { getCompanyOverview } from "@/lib/companies";
import { engerClient, dbConfigured } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function CompaniesPage() {
  const companies = (await getCompanyOverview()) ?? [];

  // 手動登録した企業マスタ（連絡先・業種・担当・メモ）。名寄せして詳細/編集に使う。
  let registered: any[] = [];
  if (dbConfigured) {
    try {
      const sb = engerClient();
      let res: any = await sb.from("companies").select("name, industry, tier, status, owner_staff, contact_name, contact_email, phone, website, address, note, last_contacted_at");
      if (res.error) res = await sb.from("companies").select("name, industry, tier, status, owner_staff, contact_name, contact_email, phone, website, address, note");
      registered = res.data ?? [];
    } catch { /* companies-extend.sql 未実行などは無視 */ }
  }

  // 3ヶ月以上ご無沙汰の企業（最終接触＝直近案件/打合せ/連絡記録のうち最新が90日超 or 未接触）
  const since90 = Date.now() - 90 * 86400000;
  const regByName = new Map(registered.map((r) => [r.name, r]));
  const names = new Set<string>([...companies.map((c) => c.name), ...registered.map((r) => r.name)]);
  const followups: FollowupRow[] = [...names].map((name) => {
    const c = companies.find((x) => x.name === name);
    const reg = regByName.get(name);
    const ts = [c?.last_meeting_at, c?.last_job_at, reg?.last_contacted_at].filter(Boolean).map((d) => new Date(d as string).getTime());
    const t = ts.length ? Math.max(...ts) : 0;
    return { name, t, owner: reg?.owner_staff || "", contactName: reg?.contact_name || "", contactEmail: reg?.contact_email || "", tier: reg?.tier || c?.tier || "C" };
  }).filter((f) => f.t === 0 || f.t < since90)
    .sort((a, b) => a.t - b.t)
    .slice(0, 60)
    .map((f) => ({ name: f.name, owner: f.owner, contactName: f.contactName, contactEmail: f.contactEmail, tier: f.tier, lastISO: f.t ? new Date(f.t).toISOString() : null, days: f.t ? Math.floor((Date.now() - f.t) / 86400000) : null }));
  const needSetup = dbConfigured && companies.length === 0 && registered.length === 0;

  const total = companies.length;
  const activeTotal = companies.reduce((a, c) => a + (c.active_jobs ?? 0), 0);

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ maxWidth: 820 }}>
          <div className="meta">Companies · 取引先（案件データから集約）</div>
          <h1>企業管理</h1>
          <div className="sub">
            取引先 <b style={{ color: "var(--color-ink)" }}>{total.toLocaleString("ja-JP")} 社</b> · 進行中案件 <b style={{ color: "var(--color-ink)" }}>{activeTotal.toLocaleString("ja-JP")} 件</b>。
            案件・人材データから自動集約。企業マスタは案件/人材が無くても残ります。
          </div>
        </div>
        <div style={{ flexShrink: 0 }}><CompanyCsv registered={registered} /></div>
      </div>

      {needSetup && (
        <div className="card" style={{ background: "var(--color-brand-25)", borderColor: "var(--color-brand-100)" }}>
          <b>集計関数が未作成です。</b> SQL Editor で <span className="mono">supabase/companies-rpc.sql</span> を実行すると、案件のクライアント名から企業一覧が表示されます。
        </div>
      )}

      {followups.length > 0 && <CompanyFollowups items={followups} />}

      {!needSetup && <CompaniesView companies={companies} registered={registered} />}
    </div>
  );
}
