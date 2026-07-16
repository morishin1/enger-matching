import { CompaniesView } from "@/components/CompaniesView";
import { CompanyCsv } from "@/components/CompanyCsv";
import { CompanyFollowups, type FollowupRow } from "@/components/CompanyFollowups";
import { CompanyProposalsRanking } from "@/components/CompanyProposalsRanking";
import { CompanyTargetingBoard } from "@/components/CompanyTargetingBoard";
import { CompanyContactBoard } from "@/components/CompanyContactBoard";
import { getCompanyOverview } from "@/lib/companies";
import { getCompanyRatings } from "@/lib/company-ratings";
import { FlowSteps } from "@/components/FlowSteps";
import { CompaniesTabs } from "@/components/CompaniesTabs";
import { loadCompanyFunnels, loadCompanyContactFunnels, loadCompanyTopSkills } from "@/lib/company-funnel";
import { engerClient, dbConfigured } from "@/lib/supabase";
import { currentAccess, listAccounts, listLpPendingCandidates } from "@/lib/accounts";
import { NewRegistrationsList } from "@/components/NewRegistrationsList";

export const dynamic = "force-dynamic";

export default async function CompaniesPage({ searchParams }: { searchParams?: Promise<{ tab?: string }> }) {
  const sp = searchParams ? await searchParams : {};
  // 新着タブ：エンジャービジネス（enger.jp 法人登録）経由の企業の新規登録（承認待ち）。
  //   app_users（client/partner・pending）＋ LP 仮想行（business フラグ持ち）を合算。
  const newCompanyRegs = await Promise.all([listAccounts(), listLpPendingCandidates()]).then(([real, lp]) =>
    [...real.filter((a) => a.status === "pending"), ...lp]
      .filter((a) => a.role === "client" || a.role === "partner")
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))),
  ).catch(() => []);
  // 並列取得：企業概要・提案ファネル・担当者別ファネル・案件スキル分布
  const [companies, funnels, contactFunnels, topSkillsByCompany, companyRatings] = await Promise.all([
    getCompanyOverview().then((r) => r ?? []),
    loadCompanyFunnels(),
    loadCompanyContactFunnels(),
    loadCompanyTopSkills(),
    getCompanyRatings(),
  ]);
  // 情報持ち出し防止：CSV取込/書出/テンプレは admin のみに開放。
  // ローカル（認証未設定）は admin 相当として開放、それ以外は role==="admin" のみ。
  const access = await currentAccess();
  const isAdmin = !access || access.role === "admin";

  // 手動登録した企業マスタ（連絡先・業種・担当・メモ）。名寄せして詳細/編集に使う。
  //   ★重要：meeting_done（打合せ済フラグ）は is_ng / last_contacted_at 等の「任意列」と
  //     同じ SELECT にまとめると、任意列が未整備のときフォールバックで meeting_done ごと
  //     落ちてしまい、「DBには true があるのに一覧は未」という事故になる。
  //     そこで meeting_done を任意列から切り離して取得する。
  let registered: any[] = [];
  if (dbConfigured) {
    try {
      const sb = engerClient();
      // ① コア列＋打合せフラグ（meeting_done を最優先で確実に読む。is_ng 等には依存させない）
      //   #293：企業ID（company_no）も併せて取得。未マイグレ環境（列なし）ではフォールバックで外す。
      const coreBase = "name, industry, tier, status, owner_staff, contact_name, contact_email, phone, website, address, note";
      const core = `${coreBase}, company_no`;
      let res: any = await sb.from("companies").select(`${core}, meeting_done, meeting_done_at`);
      if (res.error) res = await sb.from("companies").select(`${core}, meeting_done`);
      if (res.error) res = await sb.from("companies").select(core);
      if (res.error) res = await sb.from("companies").select(`${coreBase}, meeting_done, meeting_done_at`);
      if (res.error) res = await sb.from("companies").select(`${coreBase}, meeting_done`);
      if (res.error) res = await sb.from("companies").select(coreBase);
      registered = res.data ?? [];

      // 人材数の集計（companies の所属企業＝source_company / company / affiliation）。
      //   一覧の「人材」列＋「種別」バッジで「案件提供 vs 人材提供」を見分けるために使用。
      //   ・案件マッチング業務には影響しないため candidates 未整備でも fail-soft。
      //   ・最大 30000 件まで取って JS で集計（normName で表記揺れを吸収）。

      // 任意列読み出しの後段で candidateCounts も並列に作りたいが、ここではシンプルに直列で。
      // ② 任意列（NG / 最終接触）は別クエリで取得して name でマージ。
      //    これらが未整備でも meeting_done の表示は壊れない（fail-soft）。
      try {
        let ext: any = await sb.from("companies").select("name, last_contacted_at, is_ng, ng_reason");
        if (ext.error) ext = await sb.from("companies").select("name, last_contacted_at, is_ng");
        if (ext.error) ext = await sb.from("companies").select("name, is_ng, ng_reason");
        if (ext.error) ext = await sb.from("companies").select("name, last_contacted_at");
        if (!ext.error && Array.isArray(ext.data)) {
          const em = new Map<string, any>(ext.data.map((r: any) => [r.name, r]));
          registered = registered.map((r: any) => ({ ...r, ...(em.get(r.name) ?? {}) }));
        }
      } catch { /* 任意列が無くても続行 */ }

      // ③ CRMループ用の任意列（対応特性タグ・取引注意・WEB評判）。別クエリで fail-soft に取得してマージ。
      //    supabase/companies-crm-loop.sql 未実行の環境でも一覧は壊れない。
      try {
        const crm: any = await sb.from("companies").select("name, caution, caution_reason, caution_at, contact_pref, response_speed, decision_speed, web_reputation, web_reputation_source, web_reputation_at");
        if (!crm.error && Array.isArray(crm.data)) {
          const cm = new Map<string, any>(crm.data.map((r: any) => [r.name, r]));
          registered = registered.map((r: any) => ({ ...r, ...(cm.get(r.name) ?? {}) }));
        }
      } catch { /* CRMループ列が未整備でも続行 */ }
    } catch { /* companies-extend.sql 未実行などは無視 */ }
  }

  // 企業評価（会いたい/検討中/ミスマッチ）を企業ごとに集計 → 攻め先スコアの「決まりやすさ」に注入。
  //   client_feedback は company で名寄せ。未整備でも fail-soft（空マップ）。
  const feedbackByCompany: Record<string, { want: number; maybe: number; mismatch: number }> = {};
  if (dbConfigured) {
    try {
      const sb = engerClient();
      const fr: any = await sb.from("client_feedback").select("company, verdict").not("company", "is", null).limit(20000);
      const nrm = (s: string) => (s ?? "").replace(/^[\s　]+|[\s　]+$/g, "");
      for (const row of (fr.data ?? [])) {
        const k = nrm(String(row.company ?? ""));
        if (!k) continue;
        const b = (feedbackByCompany[k] ??= { want: 0, maybe: 0, mismatch: 0 });
        if (row.verdict === "want") b.want++;
        else if (row.verdict === "maybe") b.maybe++;
        else if (row.verdict === "mismatch") b.mismatch++;
      }
    } catch { /* client_feedback 未整備でも続行 */ }
  }

  // 人材数（candidates の所属企業＝source_company / company / affiliation）を集計。
  //   ・名前単位で件数を返す（同一人材が複数列に同じ企業名を持っても 1 件）
  //   ・companies 未整備でも fail-soft（一覧の他の機能は壊れない）。
  const candidateCounts: Record<string, number> = {};
  if (dbConfigured) {
    try {
      const sb = engerClient();
      let cr: any = await sb.from("candidates").select("id, source_company, company, affiliation").is("deleted_at", null).limit(30000);
      if (cr.error) cr = await sb.from("candidates").select("id, source_company, company, affiliation").limit(30000);
      const rows: any[] = cr.error ? [] : (cr.data ?? []);
      for (const r of rows) {
        const seen = new Set<string>();
        for (const v of [r.source_company, r.company, r.affiliation] as (string | null | undefined)[]) {
          const n = (v ?? "").toString().trim();
          if (!n) continue;
          if (seen.has(n)) continue;
          seen.add(n);
          candidateCounts[n] = (candidateCounts[n] ?? 0) + 1;
        }
      }
    } catch { /* 集計失敗時は空のまま（一覧の他機能に影響なし） */ }
  }

  // LINE でやり取りしている企業の集合（企業名の正規化キー）。
  //   proposals.source='line' に紐づく会社名を集めて、一覧で「💬 LINE」バッジを出す。
  //   ・source 列が無い環境では空集合（バッジ無し）にフォールバック。
  //   ・突合は企業名の正規化（前後空白除去）で行う（CompaniesView と同じ normName 方針）。
  const lineCompanyKeys = new Set<string>();
  if (dbConfigured) {
    try {
      const sb = engerClient();
      const lr: any = await sb.from("proposals").select("company").eq("source", "line").not("company", "is", null).limit(5000);
      if (!lr.error && Array.isArray(lr.data)) {
        for (const r of lr.data) {
          const n = (r.company ?? "").toString().replace(/^[\s　]+|[\s　]+$/g, "");
          if (n) lineCompanyKeys.add(n);
        }
      }
    } catch { /* source 列が無い等は無視（バッジ無しで続行） */ }
  }
  const lineCompanies = Array.from(lineCompanyKeys);

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
  // 突合は正規化（前後の空白・全角スペース除去）した企業名で行う（CompaniesView と同じ方針）。
  const normName = (s?: string | null) => (s ?? "").replace(/^[\s　]+|[\s　]+$/g, "");
  const since90 = Date.now() - 90 * 86400000;
  const regByName = new Map(registered.map((r) => [normName(r.name), r]));
  const names = new Set<string>([...companies.map((c) => c.name), ...registered.map((r) => r.name)]);
  const followups: FollowupRow[] = [...names].map((name) => {
    const c = companies.find((x) => normName(x.name) === normName(name));
    const reg = regByName.get(normName(name));
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

      {/* タブで分割してスクロールを削減（既定＝企業一覧。?tab=new で新着タブを直接開ける） */}
      <CompaniesTabs
        followCount={followups.length}
        newCount={newCompanyRegs.length}
        initialTab={sp.tab === "new" ? "new" : undefined}
        newRegs={<NewRegistrationsList rows={newCompanyRegs} kind="company" />}
        list={!needSetup && <CompaniesView companies={companies} registered={registered} candidateCounts={candidateCounts} lineCompanies={lineCompanies} ratings={companyRatings} feedback={feedbackByCompany} />}
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
