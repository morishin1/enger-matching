// ============================================================
// ENGER business（enger-lp）向け：自社案件に見合う候補者を ENGER 人材DBから匿名で返す（#426）。
//   ・GET … ログイン企業の登録案件（client_name 一致）× ENGER 人材プールをマッチングし、
//           スコア上位の候補者を「匿名（イニシャル/職種/スキル/単価帯/年代）」で返す。
//   ・企業には氏名・所属などの個人特定情報は返さない（既存の匿名表示規約に準拠）。
//   認証：Bearer。承認済み法人（status=active）のみフル利用。未承認は locked を返す。
// ============================================================
import { NextRequest, NextResponse } from "next/server";
import { engerAdmin, dbConfigured } from "@/lib/supabase";
import { bizCorsHeaders, resolveBusinessViewer } from "@/lib/business-api";
import { scoreMatch, overlapSkills, canon, candRemoteLabel, type Job, type Candidate } from "@/lib/match";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const METHODS = "GET,OPTIONS";
const JOB_CAP = 30;         // マッチ対象にする自社案件の上限（新しい順）
const CAND_CAP = 1500;      // 走査する人材プールの上限（新しい順）
const SCORE_FLOOR = 55;     // これ未満の最良スコアは「見合う候補」に含めない
const RESULT_CAP = 50;      // 返す候補者数の上限

export function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: bizCorsHeaders(req.headers.get("origin"), METHODS) });
}

export async function GET(req: NextRequest) {
  const cors = bizCorsHeaders(req.headers.get("origin"), METHODS);
  const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: cors });
  if (!dbConfigured) return json({ ok: false, error: "DB未設定" }, 503);

  const viewer = await resolveBusinessViewer(req, { allowPending: true });
  if (!viewer.ok) return json({ ok: false, error: viewer.error }, viewer.status);
  // 承認済み法人のみフル利用（未承認はロック表示にする）。
  if (viewer.status !== "active") {
    return json({ ok: true, candidates: [], locked: true, message: "アカウントが承認されると、案件に見合う候補者が表示されます。" });
  }

  try {
    const sb = engerAdmin();

    // ① 自社の登録案件（マッチのタネ）。スキルが入っている案件のみ対象。
    const jobCols = "job_no, title, role_label, skills, salary_min, salary_max, remote_type, start_date";
    let jr: any = await sb.from("jobs").select(jobCols).eq("client_name", viewer.companyName).order("job_no", { ascending: false }).limit(JOB_CAP);
    if (jr.error) jr = await sb.from("jobs").select("job_no, title, role_label, skills, salary_min, salary_max, remote_type").eq("client_name", viewer.companyName).order("job_no", { ascending: false }).limit(JOB_CAP);
    if (jr.error) return json({ ok: false, error: jr.error.message }, 500);
    const jobs: Job[] = (jr.data ?? []).filter((j: any) => Array.isArray(j.skills) && j.skills.length > 0);
    if (jobs.length === 0) {
      return json({ ok: true, candidates: [], reason: "no_jobs", message: "スキルを登録した案件がありません。案件を登録すると、見合う候補者が表示されます。" });
    }
    // 全案件スキルの和集合（候補者の粗ふるい用）。
    const jobSkillUnion = new Set<string>();
    for (const j of jobs) for (const s of j.skills ?? []) jobSkillUnion.add(canon(s));

    // ② ENGER 人材プール（クローズ・削除済みは除外／スキル未登録は除外）。
    const candCols = "candidate_no, title, skills, rate, salary_min, salary_max, remote_pref, exp, avail, age_band, nationality, source_company, is_closed, created_at";
    let cr: any = await sb.from("candidates").select(candCols).is("deleted_at", null).eq("is_closed", false).order("candidate_no", { ascending: false }).limit(CAND_CAP);
    if (cr.error) cr = await sb.from("candidates").select("candidate_no, title, skills, rate, salary_min, salary_max, remote_pref, exp, avail, age_band, nationality, source_company, created_at").is("deleted_at", null).order("candidate_no", { ascending: false }).limit(CAND_CAP);
    if (cr.error) cr = await sb.from("candidates").select("candidate_no, title, skills, rate, salary_min, salary_max, remote_pref, exp, avail, age_band, created_at").order("candidate_no", { ascending: false }).limit(CAND_CAP);
    if (cr.error) return json({ ok: false, error: cr.error.message }, 500);

    type Rec = {
      candidate_no: number | null;
      title: string | null;
      skills: string[];
      matched_skills: string[];
      rate: string | null;
      age_band: string | null;
      exp: string | null;
      remote_pref: string | null;
      score: number;
      job_no: number | null;
      job_title: string | null;
    };
    const recs: Rec[] = [];

    for (const raw of (cr.data ?? []) as any[]) {
      const candSkills: string[] = Array.isArray(raw.skills) ? raw.skills : [];
      if (candSkills.length === 0) continue;
      // 自社が登録した人材は「ENGER からのおすすめ」には含めない。
      if (raw.source_company && String(raw.source_company) === viewer.companyName) continue;
      // 粗ふるい：どの案件スキルとも被らない人材はスコア計算せずスキップ（高速化）。
      if (!candSkills.some((s) => jobSkillUnion.has(canon(s)))) continue;

      const c: Candidate = {
        candidate_no: raw.candidate_no ?? undefined,
        name: "", // マッチング計算に不要（匿名）
        title: raw.title ?? null,
        skills: candSkills,
        salary_min: raw.salary_min ?? null,
        salary_max: raw.salary_max ?? null,
        rate: raw.rate ?? null,
        remote_pref: raw.remote_pref ?? null,
        exp: raw.exp ?? null,
        avail: raw.avail ?? null,
        age_band: raw.age_band ?? null,
        nationality: raw.nationality ?? null,
        created_at: raw.created_at ?? null,
      };

      // 各自社案件に対してスコア。最良の案件（除外されていないもの）を採用。
      let best: { score: number; job: Job; matched: string[] } | null = null;
      for (const j of jobs) {
        // この案件と1つも被らないなら計算しない。
        if (!candSkills.some((s) => (j.skills ?? []).map(canon).includes(canon(s)))) continue;
        const m = scoreMatch(j, c);
        if (m.excluded) continue;
        if (!best || m.score > best.score) best = { score: m.score, job: j, matched: m.matchedSkills };
      }
      if (!best || best.score < SCORE_FLOOR) continue;

      recs.push({
        candidate_no: raw.candidate_no ?? null,
        title: raw.title ?? null,
        skills: candSkills.slice(0, 12),
        matched_skills: (best.matched && best.matched.length ? best.matched : overlapSkills(best.job.skills, candSkills)).slice(0, 10),
        rate: raw.rate ?? null,
        age_band: raw.age_band ?? null,
        exp: raw.exp ?? null,
        remote_pref: candRemoteLabel(raw.remote_pref),
        score: best.score,
        job_no: best.job.job_no ?? null,
        job_title: best.job.title ?? null,
      });
    }

    recs.sort((a, b) => b.score - a.score);
    return json({ ok: true, candidates: recs.slice(0, RESULT_CAP), jobs_scanned: jobs.length });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
}
