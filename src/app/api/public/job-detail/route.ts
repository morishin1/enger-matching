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
import { engerAdmin, authAdmin, publicAdmin, dbConfigured } from "@/lib/supabase";
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

/** 閲覧者の面談済フラグを解決。Bearer トークン（推奨）→ viewer メール（検証用）の順。
 *  #318：判定ソースを2系統の OR にする。
 *    ① public.profiles.agent_meeting_done_at …… LP登録者の正準フラグ。
 *       DX「フリーランス登録者一覧」の面談済チェック（setEngineerMeetingDone）が書く列で、
 *       LP登録者は enger.app_users に行が無いため、従来の②だけでは常に false になり
 *       「チェックしたのに案件詳細が見えない・応募できない」事故になっていた。
 *       profiles.id ＝ auth.users.id（LP登録は auth の uid を profiles PK に使う想定）を第一に、
 *       旧データ向けに email でもフォールバック照合する。
 *    ② enger.app_users.meeting_done …… 社内/ビジネス系アカウント向け（従来どおり維持）。
 *  いずれも列・テーブル未整備の環境では fail-soft（false 側に倒す）。 */
async function resolveViewerGate(req: NextRequest): Promise<{ email: string; meetingDone: boolean }> {
  let email = "";
  let uid = "";
  const auth = req.headers.get("authorization");
  const token = auth && auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  if (token) {
    try {
      const r: any = await authAdmin().auth.getUser(token);
      email = (r?.data?.user?.email ?? "").trim();
      uid = (r?.data?.user?.id ?? "").trim();
    } catch { /* 無効トークンは未認証扱い */ }
  }
  if (!email) email = (req.nextUrl.searchParams.get("viewer") ?? "").trim();
  if (!email && !uid) return { email: "", meetingDone: false };

  // ① LP正準：public.profiles.agent_meeting_done_at（uid → email の順で照合）
  let meetingDone = false;
  try {
    const pub = publicAdmin();
    let pr: any = null;
    if (uid) pr = await pub.from("profiles").select("agent_meeting_done_at").eq("id", uid).maybeSingle();
    if ((!pr || pr.error || !pr.data) && email) pr = await pub.from("profiles").select("agent_meeting_done_at").ilike("email", email).limit(1).maybeSingle();
    if (pr && !pr.error && pr.data?.agent_meeting_done_at) meetingDone = true;
  } catch { /* profiles / 列未整備は無視して②へ */ }

  // ② 社内/ビジネス：enger.app_users.meeting_done（従来ロジック）
  if (!meetingDone && email) {
    try {
      const r: any = await engerAdmin().from("app_users").select("meeting_done").ilike("email", email).maybeSingle();
      meetingDone = !!r?.data?.meeting_done;
    } catch { /* app_users 未整備は無視 */ }
  }
  return { email, meetingDone };
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
