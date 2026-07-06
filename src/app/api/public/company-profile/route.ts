// ============================================================
// ENGER business（enger-lp）向け：会社情報の取得/保存API。
//   ・GET  … ログイン企業の会社情報（enger.company_profiles ＋ enger.companies 企業管理）を返す。
//   ・PUT  … 会社情報を保存。company_profiles（Mission等）と companies（企業管理：業種・担当者・
//            電話・サイト）へ同時反映し、DX の企業管理・マッチングと常に連動させる。
//   認証：Bearer（Supabaseアクセストークン）。法人アカウント（app_users active）のみ。
//   項目定義は /api/public/form-defs（business-forms.ts）が正。
// ============================================================
import { NextRequest, NextResponse } from "next/server";
import { engerAdmin, dbConfigured } from "@/lib/supabase";
import { bizCorsHeaders, resolveBusinessViewer } from "@/lib/business-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const METHODS = "GET,PUT,OPTIONS";

export function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: bizCorsHeaders(req.headers.get("origin"), METHODS) });
}

const s = (v: unknown, max = 2000): string | null => { const t = String(v ?? "").trim(); return t ? t.slice(0, max) : null; };

export async function GET(req: NextRequest) {
  const cors = bizCorsHeaders(req.headers.get("origin"), METHODS);
  const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: cors });
  if (!dbConfigured) return json({ ok: false, error: "DB未設定" }, 503);
  const viewer = await resolveBusinessViewer(req);
  if (!viewer.ok) return json({ ok: false, error: viewer.error }, viewer.status);

  const sb = engerAdmin();
  // company_profiles（Mission等）と companies（企業管理）を併読してマージ。
  let profile: any = {};
  try {
    const r: any = await sb.from("company_profiles").select("mission, culture, ideal_persona, appeal, website, corporate_no").eq("company", viewer.companyName).maybeSingle();
    if (r.error) { // corporate_no 未整備環境は列を落として再取得
      const r2: any = await sb.from("company_profiles").select("mission, culture, ideal_persona, appeal, website").eq("company", viewer.companyName).maybeSingle();
      profile = r2?.data ?? {};
    } else profile = r?.data ?? {};
  } catch { /* 未作成は空 */ }
  let master: any = {};
  try {
    const r: any = await sb.from("companies").select("industry, contact_name, phone, website").eq("name", viewer.companyName).maybeSingle();
    master = r?.data ?? {};
  } catch { /* 未作成は空 */ }

  return json({
    ok: true,
    company: {
      name: viewer.companyName,
      website: profile.website ?? master.website ?? null,
      corporate_no: profile.corporate_no ?? null,
      industry: master.industry ?? null,
      contact_name: master.contact_name ?? null,
      phone: master.phone ?? null,
      mission: profile.mission ?? null,
      culture: profile.culture ?? null,
      ideal_persona: profile.ideal_persona ?? null,
      appeal: profile.appeal ?? null,
    },
  });
}

export async function PUT(req: NextRequest) {
  const cors = bizCorsHeaders(req.headers.get("origin"), METHODS);
  const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: cors });
  if (!dbConfigured) return json({ ok: false, error: "DB未設定" }, 503);
  const viewer = await resolveBusinessViewer(req);
  if (!viewer.ok) return json({ ok: false, error: viewer.error }, viewer.status);

  let body: any = null;
  try { body = await req.json(); } catch { return json({ ok: false, error: "JSONボディが必要です" }, 400); }

  const sb = engerAdmin();
  // ① company_profiles（Mission 等）を upsert。corporate_no 未整備環境は列を外して再試行。
  const prow: Record<string, any> = {
    company: viewer.companyName,
    mission: s(body.mission), culture: s(body.culture), ideal_persona: s(body.ideal_persona), appeal: s(body.appeal),
    website: s(body.website, 300), corporate_no: s(String(body.corporate_no ?? "").replace(/\D/g, ""), 13),
    updated_at: new Date().toISOString(),
  };
  let { error } = await sb.from("company_profiles").upsert(prow, { onConflict: "company" });
  if (error && /corporate_no|column|schema cache/i.test(error.message ?? "")) {
    delete prow.corporate_no;
    ({ error } = await sb.from("company_profiles").upsert(prow, { onConflict: "company" }));
  }
  if (error) return json({ ok: false, error: error.message }, 500);

  // ② 企業管理（companies）へも連動反映（存在する項目のみ・空では上書きしない）。
  try {
    const crow: Record<string, any> = { name: viewer.companyName };
    const industry = s(body.industry, 100); if (industry) crow.industry = industry;
    const contact = s(body.contact_name, 60); if (contact) crow.contact_name = contact;
    const phone = s(body.phone, 40); if (phone) crow.phone = phone;
    const website = s(body.website, 300); if (website) crow.website = website;
    if (Object.keys(crow).length > 1) {
      const r: any = await sb.from("companies").upsert(crow, { onConflict: "name" });
      if (r.error) await sb.from("companies").upsert({ name: viewer.companyName }, { onConflict: "name" });
    }
  } catch { /* 企業管理側の反映失敗でも会社情報保存は成立させる */ }

  return json({ ok: true });
}
