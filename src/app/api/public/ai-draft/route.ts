// ============================================================
// ENGER business（enger-lp）向け：AI下書きAPI（会社情報／案件／人材）。
//   POST { kind: "company"|"job"|"candidate", website?, corporate_no?, text? }
//   ・company  … website（会社HP）または corporate_no（法人番号→gBizINFO）から
//                Mission・カルチャー・求める人物像・魅力・業種を下書き。
//   ・job      … 案件票・依頼文などのフリーテキスト → DX案件フォーム項目のJSON。
//   ・candidate… スキルシート概要などのフリーテキスト → DX人材フォーム項目のJSON（匿名前提）。
//   生成ロジックは DX ポータルと同一（business-ai.ts を共用）。項目は /api/public/form-defs と一致。
//   認証：Bearer。乱用防止に 1アカウント 30回/日 の上限（ai_usage で計数・フェイルオープン）。
// ============================================================
import { NextRequest, NextResponse } from "next/server";
import { bizCorsHeaders, resolveBusinessViewer } from "@/lib/business-api";
import { draftCompanyFromSource, draftJobFromText, draftCandidateFromText } from "@/lib/business-ai";
import { countTodayUsage } from "@/lib/ai-usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const METHODS = "POST,OPTIONS";
const DAILY_LIMIT = 30;
const FEATURE: Record<string, string> = { company: "biz_company_draft", job: "biz_job_draft", candidate: "biz_cand_draft" };

export function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: bizCorsHeaders(req.headers.get("origin"), METHODS) });
}

export async function POST(req: NextRequest) {
  const cors = bizCorsHeaders(req.headers.get("origin"), METHODS);
  const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: cors });
  const viewer = await resolveBusinessViewer(req);
  if (!viewer.ok) return json({ ok: false, error: viewer.error }, viewer.status);

  let body: any = null;
  try { body = await req.json(); } catch { return json({ ok: false, error: "JSONボディが必要です" }, 400); }
  const kind = String(body?.kind ?? "");
  const feature = FEATURE[kind];
  if (!feature) return json({ ok: false, error: "kind は company / job / candidate のいずれかです" }, 400);

  // 乱用防止：1アカウントあたり日次上限（計数不可の環境では制限せず通す）。
  const used = await countTodayUsage(feature, viewer.email);
  if (used >= DAILY_LIMIT) return json({ ok: false, error: `本日のAI下書き回数の上限（${DAILY_LIMIT}回）に達しました。明日以降にお試しください。` }, 429);

  const r = kind === "company"
    ? await draftCompanyFromSource({ website: body?.website, corporateNo: body?.corporate_no }, feature, viewer.email)
    : kind === "job"
      ? await draftJobFromText(String(body?.text ?? ""), feature, viewer.email)
      : await draftCandidateFromText(String(body?.text ?? ""), feature, viewer.email);

  if (!r.ok) return json({ ok: false, error: r.error }, 422);
  return json({ ok: true, kind, draft: r.draft });
}
