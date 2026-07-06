// ============================================================
// ENGER business（enger-lp）向け：自社人材の一覧/登録API。
//   ・GET  … ログイン企業が登録した自社人材の一覧（匿名項目のみ返す）。
//   ・POST … 人材を登録。項目は /api/public/form-defs の candidate 定義（DX人材フォーム）と一致。
//            source_company / owner_company に自社名を設定して登録するため、そのまま
//            DX のマッチング対象になり、テナント分離（他社には匿名/非表示）も既存規約どおり効く。
//   認証：Bearer。法人アカウント（app_users active）のみ。
// ============================================================
import { NextRequest, NextResponse } from "next/server";
import { engerAdmin, dbConfigured } from "@/lib/supabase";
import { bizCorsHeaders, resolveBusinessViewer } from "@/lib/business-api";
import { sanitizeCandidateDraft } from "@/lib/business-ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const METHODS = "GET,POST,OPTIONS";

export function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: bizCorsHeaders(req.headers.get("origin"), METHODS) });
}

export async function GET(req: NextRequest) {
  const cors = bizCorsHeaders(req.headers.get("origin"), METHODS);
  const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: cors });
  if (!dbConfigured) return json({ ok: false, error: "DB未設定" }, 503);
  const viewer = await resolveBusinessViewer(req);
  if (!viewer.ok) return json({ ok: false, error: viewer.error }, viewer.status);

  try {
    const sb = engerAdmin();
    // 自社登録分のみ・匿名項目のみ（氏名・連絡先はAPIから返さない＝UI規約「企業に見せる人材情報は常に匿名」）。
    const cols = "candidate_no, initials, title, skills, rate, salary_min, salary_max, remote_pref, exp, avail, location, age_band, nationality, status, created_at";
    let r: any = await sb.from("candidates").select(cols).eq("source_company", viewer.companyName).is("deleted_at", null).order("candidate_no", { ascending: false }).limit(200);
    if (r.error) r = await sb.from("candidates").select(cols).eq("source_company", viewer.companyName).order("candidate_no", { ascending: false }).limit(200);
    if (r.error) return json({ ok: false, error: r.error.message }, 500);
    return json({ ok: true, candidates: r.data ?? [] });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
}

export async function POST(req: NextRequest) {
  const cors = bizCorsHeaders(req.headers.get("origin"), METHODS);
  const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: cors });
  if (!dbConfigured) return json({ ok: false, error: "DB未設定" }, 503);
  const viewer = await resolveBusinessViewer(req);
  if (!viewer.ok) return json({ ok: false, error: viewer.error }, viewer.status);

  let body: any = null;
  try { body = await req.json(); } catch { return json({ ok: false, error: "JSONボディが必要です" }, 400); }

  const d = sanitizeCandidateDraft(body ?? {});
  const name = String(body?.name ?? "").trim().slice(0, 60);
  if (!d.initials?.trim() && !name) return json({ ok: false, error: "イニシャル（または氏名）を入力してください" }, 422);
  if (!d.skills || d.skills.length === 0) return json({ ok: false, error: "スキルを1つ以上入力してください（マッチングの主軸になります）" }, 422);
  const initials = d.initials?.trim() || (name ? `${name[0]}.` : "");

  try {
    const sb = engerAdmin();
    // candidate_no は連番。最大値+1。
    const { data: maxRow } = await sb.from("candidates").select("candidate_no").order("candidate_no", { ascending: false }).limit(1).maybeSingle();
    const nextNo = (Number((maxRow as any)?.candidate_no) || 0) + 1;

    const row: Record<string, any> = {
      candidate_no: nextNo,
      name: name || initials,     // 氏名未入力はイニシャルで登録（企業への表示は常に匿名）
      initials,
      title: d.title ?? null,
      skills: d.skills,
      rate: d.rate ?? null,
      salary_min: d.salary_min ?? null,
      salary_max: d.salary_max ?? null,
      remote_pref: d.remote_pref ?? null,
      exp: d.exp ?? null,
      avail: d.avail ?? null,
      location: d.location ?? null,
      age_band: d.age_band ?? null,
      nationality: d.nationality ?? null,
      note: d.note ?? null,
      status: "新規",
      source_company: viewer.companyName,   // 所属（登録元）企業
      owner_company: viewer.companyName,    // テナント分離（パートナー匿名表示の既存規約に従う）
      source_csv: `business:${viewer.companyName}`, // 登録元の追跡
    };
    let ins: any = await sb.from("candidates").insert(row).select("candidate_no").maybeSingle();
    // 列未整備の環境（owner_company / source_csv / note 等）は該当キーを外して再試行。
    if (ins.error && /column|schema cache/i.test(ins.error.message ?? "")) {
      for (const k of ["owner_company", "source_csv", "note", "age_band", "nationality", "avail"]) delete row[k];
      ins = await sb.from("candidates").insert(row).select("candidate_no").maybeSingle();
    }
    if (ins.error) return json({ ok: false, error: ins.error.message }, 500);
    return json({ ok: true, candidate_no: ins.data?.candidate_no ?? nextNo }, 201);
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
}
