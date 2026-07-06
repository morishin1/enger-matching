// ENGER business 向け公開API（/api/public/*）の共通基盤（サーバー専用）。
//   ・CORS：enger 系オリジン（*.enger.jp）のみ許可（/api/public/job-detail と同じパターン）。
//   ・認証：Authorization: Bearer <Supabaseアクセストークン>（推奨）→ email 解決。
//           検証用フォールバックとして ?viewer=<メール> も受ける（job-detail と同じ）。
//   ・認可：enger.app_users の法人系ロール（client/partner。admin/agent は動作確認用に許可）
//           かつ status=active のみ。承認待ち・無効・未作成はエラーメッセージで区別して返す。
import { NextRequest } from "next/server";
import { engerAdmin, authAdmin } from "@/lib/supabase";

export function bizCorsHeaders(origin: string | null, methods = "GET,POST,PUT,OPTIONS"): Record<string, string> {
  const allow = origin && /^https:\/\/([a-z0-9-]+\.)?enger\.jp$/i.test(origin) ? origin : "https://enger.jp";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": methods,
    "Access-Control-Allow-Headers": "authorization,content-type",
    "Cache-Control": "no-store",
    "Vary": "Origin",
  };
}

export type BizViewer =
  | { ok: true; email: string; companyName: string; role: string; name: string | null }
  | { ok: false; status: number; error: string };

/** 閲覧者（法人アカウント）を解決。Bearer トークン → viewer メール（検証用）の順。 */
export async function resolveBusinessViewer(req: NextRequest): Promise<BizViewer> {
  let email = "";
  const auth = req.headers.get("authorization");
  const token = auth && auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  if (token) {
    try { const r: any = await authAdmin().auth.getUser(token); email = (r?.data?.user?.email ?? "").trim().toLowerCase(); } catch { /* 無効トークンは未認証扱い */ }
  }
  if (!email) email = (req.nextUrl.searchParams.get("viewer") ?? "").trim().toLowerCase();
  if (!email) return { ok: false, status: 401, error: "ログインが必要です（Authorization: Bearer <アクセストークン>）" };

  try {
    const r: any = await engerAdmin().from("app_users").select("email, name, role, status, company_name").ilike("email", email).maybeSingle();
    const u = r?.data;
    if (!u) return { ok: false, status: 403, error: "ビジネスアカウントが未登録です。承認をお待ちいただくか、担当者にお問い合わせください。" };
    if (u.status === "pending") return { ok: false, status: 403, error: "アカウントは承認待ちです。承認後にご利用いただけます。" };
    if (u.status !== "active") return { ok: false, status: 403, error: "アカウントが無効化されています。担当者にお問い合わせください。" };
    // 法人系ロールのみ（admin/agent は社内の動作確認用に許可）。
    if (!["client", "partner", "admin", "agent"].includes(u.role)) {
      return { ok: false, status: 403, error: "このAPIは法人アカウント専用です。" };
    }
    const companyName = String(u.company_name ?? "").trim();
    if (!companyName && (u.role === "client" || u.role === "partner")) {
      return { ok: false, status: 403, error: "アカウントに会社名が未設定です。担当者にご連絡ください。" };
    }
    return { ok: true, email, companyName: companyName || "ENGER", role: u.role, name: u.name ?? null };
  } catch (e) {
    return { ok: false, status: 500, error: e instanceof Error ? e.message : String(e) };
  }
}
