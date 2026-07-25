// 提案履歴・失注分析を「タブを開いた時だけ」取得するAPI。
//   従来は /proposals ページの初期描画で all=400件（履歴326+失注258を含む）を props でブラウザへ
//   送っており、egress と体感遅延の主因になっていた（5GB/月の3.6GBを今日だけで使用）。
//   ブラウザの初期表示はボード(進行中)だけにし、履歴/失注はタブを開いた時に呼ぶ。
//
// 範囲:
//   mode=history   → 全件（進行中＋終了。created_at desc・最大400件）
//   mode=analytics → 終了系のみ（見送り/失注/稼働/稼働決定。created_at desc・最大400件）
import { engerClient, engerAdmin, dbConfigured } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json" } });

export async function GET(req: Request) {
  if (!dbConfigured) return json({ ok: false, error: "DB 未設定" }, 503);
  const mode = new URL(req.url).searchParams.get("mode") ?? "history";
  try {
    let sb: ReturnType<typeof engerClient>;
    try { sb = engerAdmin(); } catch { sb = engerClient(); }

    // page.tsx の主クエリと同じフォールバック連鎖（拡張列が無い環境でも落ちないように）。
    const base = "id, job_id, candidate_id, job_title, company, candidate_name, c_init, rate, score, stage, created_at, next_action";
    const orderBy = (q: any) => q.order("created_at", { ascending: false }).limit(400);
    let res: any = await orderBy(sb.from("proposals").select(`${base}, company_contact, cand_company, cand_company_contact, cand_contact, updated_at, stage_updated_at, caller_status, proposer, partner, closer, client_contact, lost_reason, lost_phase, lost_reason_note, meeting_date, meeting_status, meeting_time, meeting_format, meeting_url, meeting_attendees, meeting_note, source, job_notify_status, cand_notify_status, job_action_type, cand_action_type, approver, approval_status, approved_at, reject_reason, cand_rating, job_rating`));
    if (res.error) res = await orderBy(sb.from("proposals").select(`${base}, updated_at, stage_updated_at, caller_status, proposer, partner, closer, client_contact, lost_reason, lost_phase, lost_reason_note, meeting_date, meeting_status, meeting_time, meeting_format, meeting_url, meeting_attendees, meeting_note, source, job_notify_status, cand_notify_status, job_action_type, cand_action_type, approver, approval_status, approved_at, reject_reason`));
    if (res.error) res = await orderBy(sb.from("proposals").select(`${base}, updated_at, stage_updated_at, caller_status, proposer, partner, closer, client_contact, lost_reason, lost_phase, lost_reason_note, meeting_date, meeting_status, source`));
    if (res.error) res = await orderBy(sb.from("proposals").select(base));
    if (res.error) return json({ ok: false, error: res.error.message }, 500);

    const all = (res.data ?? []) as any[];
    // 案件/人材の number 紐づけ（履歴UIで /jobs/{job_no}, /people/{candidate_no} のリンクに使う）。
    const jobIds  = Array.from(new Set(all.map((p) => p.job_id).filter(Boolean)));
    const candIds = Array.from(new Set(all.map((p) => p.candidate_id).filter(Boolean)));
    // signup_source（LINE登録判定）も取得。未マイグレ環境では列無しでも落ちないようフォールバック。
    const fetchJn = async () => {
      if (!jobIds.length) return [];
      let r: any = await sb.from("jobs").select("id, job_no, client_name, is_closed, signup_source").in("id", jobIds).limit(2000);
      if (r.error) r = await sb.from("jobs").select("id, job_no, client_name, is_closed").in("id", jobIds).limit(2000);
      if (r.error) r = await sb.from("jobs").select("id, job_no, is_closed").in("id", jobIds).limit(2000);
      return r.error ? [] : (r.data ?? []);
    };
    const fetchCn = async () => {
      if (!candIds.length) return [];
      let r: any = await sb.from("candidates").select("id, candidate_no, is_closed, source_company, company, signup_source").in("id", candIds).limit(2000);
      if (r.error) r = await sb.from("candidates").select("id, candidate_no, is_closed, source_company, company").in("id", candIds).limit(2000);
      return r.error ? [] : (r.data ?? []);
    };
    const [jn, cn] = await Promise.all([fetchJn(), fetchCn()]);
    const mJ: Record<string, { job_no: number; client_name: string | null; closed: boolean; line: boolean }> = {};
    for (const j of jn as any[]) if (j?.id != null) mJ[j.id] = { job_no: j.job_no, client_name: (j.client_name ?? null), closed: !!j.is_closed, line: String(j.signup_source ?? "") === "line" };
    const mC: Record<string, { candidate_no: number; closed: boolean; cand_company: string | null; line: boolean }> = {};
    for (const c of cn as any[]) if (c?.id != null) mC[c.id] = { candidate_no: c.candidate_no, closed: !!c.is_closed, cand_company: c.source_company ?? c.company ?? null, line: String(c.signup_source ?? "") === "line" };
    // 0724：クライアント名／人材会社名を「案件詳細／人材プロフィールの現在値」へ自動追随させる（提案の保存値より優先）。
    const liveCompanyOf = (p: any): string | null => (p.job_id ? mJ[p.job_id]?.client_name : null) || p.company || null;
    const liveCandCompanyOf = (p: any): string | null => (p.candidate_id ? mC[p.candidate_id]?.cand_company : null) ?? p.cand_company ?? null;
    // 案件 or 人材の会社が「打ち合わせ済」(meeting_done) かどうか（＝承認済企業の判定）。現在値ベースで集計。
    const compNames = Array.from(new Set(all.flatMap((p) => [liveCompanyOf(p), liveCandCompanyOf(p)]).filter(Boolean))) as string[];
    const meetingDoneByCompany: Record<string, boolean> = {};
    if (compNames.length) {
      const cr: any = await sb.from("companies").select("name, meeting_done").in("name", compNames).limit(5000);
      if (!cr.error) for (const c of (cr.data ?? []) as any[]) if (c?.name) meetingDoneByCompany[c.name] = !!c.meeting_done;
    }
    for (const p of all) {
      if (p.job_id && mJ[p.job_id])       { p.job_no = mJ[p.job_id].job_no; p.job_closed = mJ[p.job_id].closed; }
      if (p.candidate_id && mC[p.candidate_id]) { p.candidate_no = mC[p.candidate_id].candidate_no; p.cand_closed = mC[p.candidate_id].closed; }
      // 0724：クライアント名／人材会社名を案件詳細・人材プロフィールの現在値へ追随。
      p.company = liveCompanyOf(p);
      p.cand_company = liveCandCompanyOf(p);
      // LINE経由（案件 or 人材のどちらかが LINE登録、または提案自体が source='line'）。
      p.line_origin = String(p.source ?? "") === "line" || !!(p.job_id && mJ[p.job_id]?.line) || !!(p.candidate_id && mC[p.candidate_id]?.line);
      // 承認済（企業マスタ「打ち合わせ済」ON）。案件 or 人材いずれかの会社が打合せ済なら承認済扱い。
      p.company_approved = !!(meetingDoneByCompany[p.company] || (p.cand_company && meetingDoneByCompany[p.cand_company]));
      p.lp_direct = /直接応募/.test(String(p.next_action ?? ""));
    }

    const rows = mode === "analytics"
      ? all.filter((p) => ["見送り", "失注", "稼働", "稼働決定"].includes(p.stage))
      : all;
    return json({ ok: true, rows });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
}
