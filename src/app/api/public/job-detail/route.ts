// ============================================================
// フリーランス（enger.jp）向け：案件詳細の連携API（DX = enger-matching が唯一の正）
//   ・「案件を探す」の案件詳細パネルに出す “指定項目だけ” を返す（ホワイトリストをサーバ側で強制）。
//     → DBに他の項目があってもこのAPIからは絶対に露出しない（要件の最重要点）。
//   ・面談済ゲート：閲覧者(フリーランス)の app_users.meeting_done が true のときのみ、
//     開始希望日・国籍要件・年代制限を開示し、canApply=true（応募可）を返す。
//   ・国籍要件・年代制限は専用カラムが無いため、DX のロジックでサーバ側算出して返す。
//
//   呼び出し（enger-lp / ブラウザから cross-origin）:
//     GET /api/public/job-detail?job_no=123
//       Authorization: Bearer <Supabaseアクセストークン>   （推奨・なりすまし防止）
//     もしくは GET ...?job_no=123&viewer=<メール>           （検証用フォールバック）
// ============================================================
import { NextRequest, NextResponse } from "next/server";
import { engerAdmin, authAdmin, dbConfigured } from "@/lib/supabase";
import { classifyJobNationality, JOB_NAT_LABEL, classifyJobAge } from "@/lib/nationality";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// enger 系オリジンのみ許可（ブラウザからの cross-origin 取得を通す）。
function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && /^https:\/\/([a-z0-9-]+\.)?enger\.jp$/i.test(origin) ? origin : "https://enger.jp";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "authorization,content-type",
    "Cache-Control": "no-store",
    "Vary": "Origin",
  };
}

const remoteLabel = (r: string | null | undefined) =>
  r === "full_remote" ? "フルリモート" : r === "partial_remote" ? "一部リモート" : r === "onsite" ? "出社" : (r || "—");

/** 閲覧者の面談済フラグを解決。Bearer トークン（推奨）→ viewer メール（検証用）の順。 */
async function resolveViewerGate(req: NextRequest): Promise<{ email: string; meetingDone: boolean }> {
  let email = "";
  const auth = req.headers.get("authorization");
  const token = auth && auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  if (token) {
    try { const r: any = await authAdmin().auth.getUser(token); email = (r?.data?.user?.email ?? "").trim(); } catch { /* 無効トークンは未認証扱い */ }
  }
  if (!email) email = (req.nextUrl.searchParams.get("viewer") ?? "").trim();
  if (!email) return { email: "", meetingDone: false };
  try {
    const r: any = await engerAdmin().from("app_users").select("meeting_done").ilike("email", email).maybeSingle();
    return { email, meetingDone: !!r?.data?.meeting_done };
  } catch { return { email, meetingDone: false }; }
}

export function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}

export async function GET(req: NextRequest) {
  const cors = corsHeaders(req.headers.get("origin"));
  const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: cors });

  if (!dbConfigured) return json({ ok: false, error: "DB未設定" }, 503);
  const jobNoRaw = req.nextUrl.searchParams.get("job_no") ?? req.nextUrl.searchParams.get("no");
  const jobNo = jobNoRaw && /^\d+$/.test(jobNoRaw) ? Number(jobNoRaw) : null;
  if (jobNo == null) return json({ ok: false, error: "job_no が必要です" }, 400);

  let row: any = null;
  try {
    const r: any = await engerAdmin()
      .from("jobs")
      .select("job_no, title, role_label, skills, salary_min, salary_max, remote_type, start_date, detail, is_published")
      .eq("job_no", jobNo).maybeSingle();
    row = r?.data ?? null;
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
  if (!row || row.is_published === false) return json({ ok: false, error: "案件が見つかりません" }, 404);

  const { meetingDone } = await resolveViewerGate(req);

  // ホワイトリスト：ここに無い項目は何があっても返さない。
  //   ・常時（面談前でも基本パネルに出る）：案件名 / No / 募集職種 / 必要スキル / 単価 / リモート可否
  //   ・面談済のみ開示：開始希望(start_date) / 国籍要件 / 年代制限
  const job: Record<string, unknown> = {
    job_no: row.job_no,
    title: row.title ?? null,
    role_label: row.role_label ?? null,
    skills: Array.isArray(row.skills) ? row.skills : [],
    salary_min: row.salary_min ?? null,
    salary_max: row.salary_max ?? null,
    remote_type: row.remote_type ?? null,
    remote_label: remoteLabel(row.remote_type),
  };
  if (meetingDone) {
    job.start_date = row.start_date ?? null;
    // 国籍要件・年代制限は専用カラムが無いため DX のロジックで本文から算出して返す。
    job.nationality_requirement = JOB_NAT_LABEL[classifyJobNationality(row.detail, row.title)];
    job.age_limit = classifyJobAge(row.detail, row.title).label;
  }

  return json({ ok: true, job, gate: { meetingDone, canApply: meetingDone } });
}
