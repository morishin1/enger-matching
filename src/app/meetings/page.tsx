import { MeetingsClient } from "@/components/MeetingsClient";
import { engerClient, dbConfigured } from "@/lib/supabase";
import { getCompanyOverview } from "@/lib/companies";
import { loadKpiMembers } from "@/lib/kpi-members";
import { loadProposalOwners } from "@/lib/proposal-owners";
import { getStaff } from "@/lib/staff";

export const dynamic = "force-dynamic";

export default async function MeetingsPage() {
  let meetings: any[] = [];
  let dbError: string | null = null;
  let needSetup = false;

  // 提案管理の面談予定（meeting_date のある提案）をカレンダーに連動表示する
  let interviews: any[] = [];
  // 企業マスタ（窓口担当者プリフィル・類似企業検出・打合せ完了フラグ連携用）。
  let companyDir: { name: string; contact_name: string | null; meeting_done: boolean }[] = [];

  if (dbConfigured) {
    try {
      const sb = engerClient();
      const { data, error } = await sb
        .from("meetings")
        .select("*")
        .order("meeting_date", { ascending: false, nullsFirst: false })
        .limit(300);
      if (error) needSetup = true;
      else meetings = data ?? [];

      // 企業マスタの窓口担当者（contact_name）と打合せ完了フラグ（meeting_done）を取得。
      //   ・窓口担当者：打合せフォームの窓口担当者プリフィルに使う。
      //   ・meeting_done：「打ち合わせ記録完了にする」チェックの初期値（企業データと連携）。
      try {
        let cr: any = await sb.from("companies").select("name, contact_name, meeting_done").limit(5000);
        if (cr.error && /meeting_done|column/i.test(cr.error.message)) cr = await sb.from("companies").select("name, contact_name").limit(5000);
        companyDir = (cr.data ?? []).filter((c: any) => c?.name).map((c: any) => ({ name: String(c.name), contact_name: c.contact_name ?? null, meeting_done: !!c.meeting_done }));
      } catch { /* companies 未整備でも続行 */ }

      // 面談予定（提案）: 失注・稼働済みを除く、面談日が入った提案
      try {
        const { data: pv } = await sb
          .from("proposals")
          .select("id, job_title, company, candidate_name, c_init, meeting_date, meeting_status, closer, proposer, stage")
          .not("meeting_date", "is", null)
          .limit(300);
        interviews = (pv ?? []).filter((p: any) => !["見送り", "失注", "稼働", "稼働決定"].includes(p.stage));
      } catch { /* meeting_date 列が無い環境では面談予定なし */ }
    } catch (e) {
      dbError = e instanceof Error ? e.message : String(e);
    }
  } else {
    dbError = "Supabase の環境変数が未設定です";
  }

  // datalist 候補は company_overview（案件/人材由来）と企業マスタ名の和集合。
  const overviewNames = ((await getCompanyOverview()) ?? []).map((c) => c.name);
  const companies = Array.from(new Set([...overviewNames, ...companyDir.map((c) => c.name)].filter(Boolean)));
  // 自社担当の選択肢：KPI推移のメンバーマスタ（編集可能）と連動。未設定時は定数フォールバック。
  // #297③：打合せ記録の「自社担当者」は、提案管理の「クロージング担当者」と同じ選択肢にする。
  //   ・提案者・クロージング担当は app_settings(proposal_owners) が正（未設定時はアカウント(app_users)由来）。
  //   ・"未割当" は提案側の内部プレースホルダなので自社担当の候補からは除外。
  //   ・後方互換で KPI推移のメンバーマスタ(kpi_members)の名前も併せて候補に含める（重複排除）。
  const [proposalOwners, staff, kpiMembers] = await Promise.all([loadProposalOwners(), getStaff(), loadKpiMembers()]);
  const closerNames = (proposalOwners?.closers && proposalOwners.closers.length ? proposalOwners.closers : staff.closers)
    .filter((n) => n && n !== "未割当");
  const owners = Array.from(new Set([...closerNames, ...kpiMembers.map((m) => m.name)].map((n) => String(n ?? "").trim()).filter(Boolean)));

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ maxWidth: 760 }}>
          <div className="meta">Meetings · 打ち合わせ記録（アウトサイド）</div>
          <h1>打ち合わせ記録</h1>
          <div className="sub">企業ごとの温度感（FB感情）・刺さった訴求点・競合言及・次回アクションを蓄積し、今後の対応に反映します。Geminiメモは要約欄に貼り付け、Drive原本はリンクで紐付けます。</div>
        </div>
      </div>

      {dbError && <div className="card" style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}><b>DB:</b> {dbError}</div>}
      {needSetup && (
        <div className="card" style={{ background: "var(--color-brand-25)", borderColor: "var(--color-brand-100)" }}>
          <b>打ち合わせ記録テーブルが未作成です。</b> SQL Editor で <span className="mono">supabase/meetings.sql</span> を実行してください。
        </div>
      )}

      {!needSetup && <MeetingsClient meetings={meetings} companies={companies} companyDir={companyDir} interviews={interviews} owners={owners} />}
    </div>
  );
}
