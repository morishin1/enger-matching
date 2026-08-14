// ============================================================
// ENGER business（enger-lp）向け：会社情報の取得/保存API。
//   ・GET  … ログイン企業の会社情報（enger.company_profiles ＋ enger.companies 企業管理）を返す。
//   ・PUT  … 会社情報を保存。company_profiles（Mission等）と companies（企業管理：業種・担当者・
//            電話・サイト）へ同時反映し、DX の企業管理・マッチングと常に連動させる。
//   認証：Bearer（Supabaseアクセストークン）。法人アカウント（app_users active）のみ。
//   項目定義は /api/public/form-defs（business-forms.ts）が正。
// ============================================================
import { NextRequest, NextResponse } from "next/server";
import { engerAdmin, authAdmin, dbConfigured } from "@/lib/supabase";
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
  const viewer = await resolveBusinessViewer(req, { allowPending: true }); // 承認前でも利用可（会社情報の充実・案件の掲載申請は審査フローに乗るため）
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

  /**
   * 無料登録時の入力を初期値に使う（#653）。
   * LPの法人登録は ご担当者名・電話・業種・サイトURL を auth の user_metadata に
   * 保存しているが、companies の行は承認時に作られるため、承認前は
   * ここが全部空で「登録時に入力した内容が一切反映されていない」ように見えていた。
   * companies（企業管理で担当が直せる正）を優先し、無ければ登録時の値で埋める。
   */
  let meta: any = {};
  try {
    const auth = req.headers.get("authorization");
    const token = auth && auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
    if (token) {
      const r: any = await authAdmin().auth.getUser(token);
      meta = (r?.data?.user?.user_metadata as any) ?? {};
    }
  } catch { /* 取れなくても既存の動きのまま */ }

  return json({
    ok: true,
    company: {
      name: viewer.companyName,
      company_name: viewer.companyName, // #414：会社名編集欄の初期値
      website: profile.website ?? master.website ?? (meta.company_url ?? null),
      corporate_no: profile.corporate_no ?? null,
      industry: master.industry ?? (meta.industry ?? null),
      contact_name: master.contact_name ?? (meta.contact_name ?? null),
      phone: master.phone ?? (meta.phone ?? null),
      /** ログインメール（#653：スカウト等の連絡先として画面に出す。変更は不可） */
      email: viewer.email,
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
  const viewer = await resolveBusinessViewer(req, { allowPending: true }); // 承認前でも利用可（会社情報の充実・案件の掲載申請は審査フローに乗るため）
  if (!viewer.ok) return json({ ok: false, error: viewer.error }, viewer.status);

  let body: any = null;
  try { body = await req.json(); } catch { return json({ ok: false, error: "JSONボディが必要です" }, 400); }

  const sb = engerAdmin();

  // #414：会社名の変更（案件・企業管理・自社情報の紐付けキーのため、関連レコードを一括リネーム）。
  //   ・他の稼働中アカウントが同名で既に使っている場合は、案件一覧の混在（データ越境）を
  //     防ぐため拒否する。
  //   ・app_users にレコードが無い（承認前・LP直後）アカウントは Auth の user_metadata.company を更新。
  let companyName = viewer.companyName;
  const requestedName = s(body.company_name, 120);
  if (requestedName && requestedName !== viewer.companyName) {
    try {
      const collide: any = await sb.from("app_users").select("email").ilike("company_name", requestedName).neq("email", viewer.email).maybeSingle();
      if (collide?.data) {
        return json({ ok: false, error: `会社名「${requestedName}」は既に別のアカウントで登録されています。別の名称にするか、同名の会社が複数登録されている場合は運営にご連絡ください。` }, 409);
      }
    } catch { /* 照合失敗時は続行（過度なブロックをしない） */ }

    const oldName = viewer.companyName;
    try {
      const au: any = await sb.from("app_users").select("email").ilike("email", viewer.email).maybeSingle();
      if (au?.data) {
        await sb.from("app_users").update({ company_name: requestedName }).ilike("email", viewer.email);
      } else {
        // app_users 未作成（承認前）：Auth の user_metadata.company を更新して次回解決時に使わせる。
        try {
          const ures: any = await authAdmin().auth.admin.listUsers({ page: 1, perPage: 1000 });
          const hit = (ures?.data?.users ?? []).find((u: any) => (u.email ?? "").toLowerCase() === viewer.email.toLowerCase());
          if (hit) await authAdmin().auth.admin.updateUserById(hit.id, { user_metadata: { ...(hit.user_metadata ?? {}), company: requestedName } });
        } catch { /* auth 側の更新失敗でも下のカスケードは進める */ }
      }
      // 既存の紐付けデータを新しい会社名へ引き継ぐ（fail-soft・未作成テーブル/未該当行はそのまま無視）。
      await sb.from("companies").update({ name: requestedName }).eq("name", oldName);
      await sb.from("company_profiles").update({ company: requestedName }).eq("company", oldName);
      await sb.from("jobs").update({ client_name: requestedName }).eq("client_name", oldName);
      companyName = requestedName;
    } catch (e: any) {
      return json({ ok: false, error: `会社名の変更に失敗しました：${e?.message ?? String(e)}` }, 500);
    }
  }

  // ① company_profiles（Mission 等）を upsert。corporate_no 未整備環境は列を外して再試行。
  const prow: Record<string, any> = {
    company: companyName,
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
    const crow: Record<string, any> = { name: companyName };
    const industry = s(body.industry, 100); if (industry) crow.industry = industry;
    const contact = s(body.contact_name, 60); if (contact) crow.contact_name = contact;
    const phone = s(body.phone, 40); if (phone) crow.phone = phone;
    const website = s(body.website, 300); if (website) crow.website = website;
    if (Object.keys(crow).length > 1) {
      const r: any = await sb.from("companies").upsert(crow, { onConflict: "name" });
      if (r.error) await sb.from("companies").upsert({ name: companyName }, { onConflict: "name" });
    }
  } catch { /* 企業管理側の反映失敗でも会社情報保存は成立させる */ }

  return json({ ok: true, company_name: companyName });
}
