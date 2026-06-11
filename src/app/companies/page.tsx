import { CompaniesView } from "@/components/CompaniesView";
import { CompanyCsv } from "@/components/CompanyCsv";
import { CompanyFollowups, type FollowupRow } from "@/components/CompanyFollowups";
import { CompanyProposalsRanking } from "@/components/CompanyProposalsRanking";
import { CompanyTargetingBoard } from "@/components/CompanyTargetingBoard";
import { CompanyContactBoard } from "@/components/CompanyContactBoard";
import { getCompanyOverview } from "@/lib/companies";
import { FlowSteps } from "@/components/FlowSteps";
import { CompaniesTabs } from "@/components/CompaniesTabs";
import { loadCompanyFunnels, loadCompanyContactFunnels, loadCompanyTopSkills } from "@/lib/company-funnel";
import { engerClient, dbConfigured } from "@/lib/supabase";
import { currentAccess } from "@/lib/accounts";

export const dynamic = "force-dynamic";

export default async function CompaniesPage() {
  // 並列取得：企業概要・提案ファネル・担当者別ファネル・案件スキル分布
  const [companies, funnels, contactFunnels, topSkillsByCompany] = await Promise.all([
    getCompanyOverview().then((r) => r ?? []),
    loadCompanyFunnels(),
    loadCompanyContactFunnels(),
    loadCompanyTopSkills(),
  ]);
  // 情報持ち出し防止：CSV取込/書出/テンプレは admin のみに開放。
  // ローカル（認証未設定）は admin 相当として開放、それ以外は role==="admin" のみ。
  const access = await currentAccess();
  const isAdmin = !access || access.role === "admin";

  // 手動登録した企業マスタ（連絡先・業種・担当・メモ）。名寄せして詳細/編集に使う。
  let registered: any[] = [];
  if (dbConfigured) {
    try {
      const sb = engerClient();
      let res: any = await sb.from("companies").select("name, industry, tier, status, owner_staff, contact_name, contact_email, phone, website, address, note, last_contacted_at, is_ng, ng_reason, meeting_done, meeting_done_at");
      // meeting_done_at だけ未整備の環境でも meeting_done（打合せ済フラグ）を取りこぼさないフォールバック。
      if (res.error) res = await sb.from("companies").select("name, industry, tier, status, owner_staff, contact_name, contact_email, phone, website, address, note, last_contacted_at, is_ng, ng_reason, meeting_done");
      if (res.error) res = await sb.from("companies").select("name, industry, tier, status, owner_staff, contact_name, contact_email, phone, website, address, note, last_contacted_at, is_ng, ng_reason");
      if (res.error) res = await sb.from("companies").select("name, industry, tier, status, owner_staff, contact_name, contact_email, phone, website, address, note, last_contacted_at");
      if (res.error) res = await sb.from("companies").select("name, industry, tier, status, owner_staff, contact_name, contact_email, phone, website, address, note");
      registered = res.data ?? [];
    } catch { /* companies-extend.sql 未実行などは無視 */ }
  }

  // 「打合せ完了（承認）」が保存できない設定かどうかを検出して、原因を画面に出す。
  //   ・SUPABASE_SERVICE_ROLE_KEY 未設定（保存処理に必須）
  //   ・companies.meeting_done 列が未整備（companies-meeting-done.sql 未実行）
  const hasServiceKey = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
  let meetingDoneCol = true;
  if (dbConfigured) {
    try { const sb = engerClient(); const probe: any = await sb.from("companies").select("meeting_done").limit(1); meetingDoneCol = !probe.error; }
    catch { meetingDoneCol = false; }
  }
  const meetingSetupIssue: "service" | "column" | null = !hasServiceKey ? "service" : !meetingDoneCol ? "column" : null;

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
        <div style={{ flexShrink: 0 }}><CompanyCsv registered={registered} isAdmin={isAdmin} /></div>
      </div>

      <FlowSteps current="data" sub="企業マスタ（案件・人材の所属企業を整える）" />

      {meetingSetupIssue && (
        <div className="card" style={{ background: "#fdecef", borderColor: "#f7c5cf", color: "#b42318", fontSize: 13 }}>
          <b>⚠ 「打ち合わせ完了（承認）」を保存できない設定です。</b> このため一覧が「未」のまま変わらず、打合せ済が必要な提案もできません。
          {meetingSetupIssue === "service" ? (
            <div style={{ marginTop: 6 }}>
              原因：環境変数 <span className="mono">SUPABASE_SERVICE_ROLE_KEY</span> が未設定です（保存処理に必須）。
              Vercel の Settings → Environment Variables に Supabase の <b>service_role</b> キーを設定し、再デプロイしてください。
            </div>
          ) : (
            <div style={{ marginTop: 6 }}>
              原因：<span className="mono">companies.meeting_done</span> 列が未整備です。
              Supabase の SQL Editor で <span className="mono">supabase/companies-meeting-done.sql</span> を実行してください。
            </div>
          )}
        </div>
      )}

      {needSetup && (
        <div className="card" style={{ background: "var(--color-brand-25)", borderColor: "var(--color-brand-100)" }}>
          <b>集計関数が未作成です。</b> SQL Editor で <span className="mono">supabase/companies-rpc.sql</span> を実行すると、案件のクライアント名から企業一覧が表示されます。
        </div>
      )}

      {/* タブで分割してスクロールを削減（既定＝企業一覧） */}
      <CompaniesTabs
        followCount={followups.length}
        list={!needSetup && <CompaniesView companies={companies} registered={registered} />}
        target={
          <>
            {/* 🎯 狙うべき企業（提案管理結果 × 市場トレンド の根拠つき分類） */}
            <CompanyTargetingBoard
              companies={companies}
              funnels={funnels}
              topSkillsByCompany={topSkillsByCompany}
              ngMap={Object.fromEntries(registered.filter((r) => r.is_ng).map((r) => [r.name, r.ng_reason ?? null]))}
            />
            {/* 👤 担当者別の決定率：相手の窓口が誰かで結果が変わるため、相性をデータで提示 */}
            <CompanyContactBoard contactsByCompany={contactFunnels} />
          </>
        }
        follow={
          <>
            {followups.length > 0 && <CompanyFollowups items={followups} />}
            <CompanyProposalsRanking companies={companies} />
          </>
        }
      />

      <div className="muted" style={{ fontSize: 11, padding: "8px 4px", color: "var(--color-ink-4)" }}>
        🔒 情報漏洩防止のため、<b>企業マスタの CSV 書き出し（ダウンロード）は廃止</b>しました（閲覧は全メンバー可、ダウンロード不可）。案件／人材の CSV 書き出しは引き続き <b>管理者・バックオフィス</b> のみ操作できます。
      </div>
    </div>
  );
}
