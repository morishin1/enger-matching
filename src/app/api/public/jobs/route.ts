// ============================================================
// ENGER business（enger-lp）向け：自社案件の一覧/掲載API。
//   ・GET  … ログイン企業の自社案件（審査中含む）を一覧で返す（LPダッシュボードの「掲載中の求人」用）。
//   ・POST … 案件を掲載申請（審査中で作成 → DX /jobs の承認後に公開＝既存フローと同一）。
//            項目は /api/public/form-defs の job 定義（DX案件フォーム）と一致。
//            登録された案件はそのまま DX のマッチング対象データになる。
//   認証：Bearer。法人アカウント（app_users active）のみ。
// ============================================================
import { NextRequest, NextResponse } from "next/server";
import { engerAdmin, dbConfigured } from "@/lib/supabase";
import { bizCorsHeaders, resolveBusinessViewer } from "@/lib/business-api";
import { insertClientJob, updateClientJob } from "@/lib/client-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const METHODS = "GET,POST,PUT,OPTIONS";

export function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: bizCorsHeaders(req.headers.get("origin"), METHODS) });
}

export async function GET(req: NextRequest) {
  const cors = bizCorsHeaders(req.headers.get("origin"), METHODS);
  const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: cors });
  if (!dbConfigured) return json({ ok: false, error: "DB未設定" }, 503);
  const viewer = await resolveBusinessViewer(req, { allowPending: true }); // 承認前でも利用可（会社情報の充実・案件の掲載申請は審査フローに乗るため）
  if (!viewer.ok) return json({ ok: false, error: viewer.error }, viewer.status);

  // #430：?job_no=X 指定時は、編集フォームのプリフィル用に該当案件1件を返す（本文 detail も含める）。
  const jobNoParam = req.nextUrl.searchParams.get("job_no");
  try {
    const sb = engerAdmin();
    if (jobNoParam != null && jobNoParam !== "") {
      const jobNo = Number(jobNoParam);
      if (!Number.isFinite(jobNo)) return json({ ok: false, error: "案件番号が不正です" }, 400);
      const oneCols = "job_no, title, role_label, skills, salary_min, salary_max, remote_type, contract_types, work_location, start_date, detail, status, review_status, is_published, created_at";
      let one: any = await sb.from("jobs").select(oneCols).eq("client_name", viewer.companyName).eq("job_no", jobNo).maybeSingle();
      if (one.error) one = await sb.from("jobs").select("job_no, title, role_label, skills, salary_min, salary_max, remote_type, work_location, start_date, status, is_published").eq("client_name", viewer.companyName).eq("job_no", jobNo).maybeSingle();
      if (one.error) return json({ ok: false, error: one.error.message }, 500);
      if (!one.data) return json({ ok: false, error: "対象の案件が見つかりません。" }, 404);
      return json({ ok: true, job: one.data });
    }
    const cols = "job_no, title, role_label, skills, salary_min, salary_max, remote_type, contract_types, work_location, start_date, status, review_status, is_published, created_at";
    let r: any = await sb.from("jobs").select(cols).eq("client_name", viewer.companyName).order("job_no", { ascending: false }).limit(200);
    if (r.error) r = await sb.from("jobs").select("job_no, title, role_label, skills, salary_min, salary_max, remote_type, status, is_published, created_at").eq("client_name", viewer.companyName).order("job_no", { ascending: false }).limit(200);
    if (r.error) return json({ ok: false, error: r.error.message }, 500);
    return json({ ok: true, jobs: r.data ?? [] });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
}

export async function PUT(req: NextRequest) {
  const cors = bizCorsHeaders(req.headers.get("origin"), METHODS);
  const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: cors });
  if (!dbConfigured) return json({ ok: false, error: "DB未設定" }, 503);
  const viewer = await resolveBusinessViewer(req, { allowPending: true });
  if (!viewer.ok) return json({ ok: false, error: viewer.error }, viewer.status);

  const jobNo = Number(req.nextUrl.searchParams.get("job_no"));
  if (!Number.isFinite(jobNo)) return json({ ok: false, error: "案件番号（job_no）が必要です" }, 400);

  let body: any = null;
  try { body = await req.json(); } catch { return json({ ok: false, error: "JSONボディが必要です" }, 400); }

  const r = await updateClientJob(viewer.companyName, jobNo, body ?? {});
  if (!r.ok) return json({ ok: false, error: r.error }, 422);
  // job_no は返さない（編集完了はフォーム側で successMessage を表示させるため）。
  return json({ ok: true, updated: true, status: "審査中" }, 200);
}

export async function POST(req: NextRequest) {
  const cors = bizCorsHeaders(req.headers.get("origin"), METHODS);
  const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: cors });
  if (!dbConfigured) return json({ ok: false, error: "DB未設定" }, 503);
  const viewer = await resolveBusinessViewer(req, { allowPending: true }); // 承認前でも利用可（会社情報の充実・案件の掲載申請は審査フローに乗るため）
  if (!viewer.ok) return json({ ok: false, error: viewer.error }, viewer.status);

  let body: any = null;
  try { body = await req.json(); } catch { return json({ ok: false, error: "JSONボディが必要です" }, 400); }

  const r = await insertClientJob(viewer.companyName, viewer.email, body ?? {});
  if (!r.ok) return json({ ok: false, error: r.error }, 422);
  return json({ ok: true, job_no: r.job_no, status: "審査中" }, 201);
}
