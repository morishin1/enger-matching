// ENGER business 向け公開API（/api/public/*）の共通基盤（サーバー専用）。
//   ・CORS：enger 系オリジン（*.enger.jp）のみ許可（/api/public/job-detail と同じパターン）。
//   ・認証：Authorization: Bearer <Supabaseアクセストークン>（推奨）→ email 解決。
//           検証用フォールバックとして ?viewer=<メール> も受ける（job-detail と同じ）。
//   ・認可：enger.app_users の法人系ロール（client/partner。admin/agent は動作確認用に許可）。
//     承認状態で機能を段階開放する（メニュー要件「承認をうけたらフル機能」）：
//       - active   … フル機能
//       - pending  … opts.allowPending=true のAPIのみ利用可（会社情報の入力・案件の下書き申請）
//       - 行なし   … auth の apps に "business" があれば pending 扱い（LP登録直後の未承認）
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

export type BizStatus = "active" | "pending" | "none";
export type BizViewer =
  | { ok: true; email: string; companyName: string; role: string; name: string | null; status: BizStatus }
  | { ok: false; status: number; error: string };

/** 閲覧者（法人アカウント）を解決。Bearer トークン → viewer メール（検証用）の順。
 *  opts.allowPending=true のとき、承認待ち（pending / app_users 未作成のビジネス認証）でも通す
 *  （会社名は app_users → auth の user_metadata.company の順でフォールバック）。 */
export async function resolveBusinessViewer(req: NextRequest, opts?: { allowPending?: boolean }): Promise<BizViewer> {
  let email = "";
  let metaCompany = "";
  let metaName = "";
  let hasBusinessApp = false;
  const auth = req.headers.get("authorization");
  const token = auth && auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  if (token) {
    try {
      const r: any = await authAdmin().auth.getUser(token);
      const u = r?.data?.user;
      email = (u?.email ?? "").trim().toLowerCase();
      metaCompany = String((u?.user_metadata as any)?.company ?? "").trim();
      metaName = String((u?.user_metadata as any)?.full_name ?? (u?.user_metadata as any)?.name ?? "").trim();
      const apps: string[] = Array.isArray((u?.app_metadata as any)?.apps) ? (u!.app_metadata as any).apps.map(String) : [];
      hasBusinessApp = apps.includes("business");
    } catch { /* 無効トークンは未認証扱い */ }
  }
  if (!email) email = (req.nextUrl.searchParams.get("viewer") ?? "").trim().toLowerCase();
  if (!email) return { ok: false, status: 401, error: "ログインが必要です（Authorization: Bearer <アクセストークン>）" };

  try {
    const r: any = await engerAdmin().from("app_users").select("email, name, role, status, company_name").ilike("email", email).maybeSingle();
    const u = r?.data;

    // app_users 未作成：ビジネス認証（apps=business）なら承認待ち扱い。それ以外は拒否。
    if (!u) {
      if (hasBusinessApp && opts?.allowPending) {
        const companyName = metaCompany;
        if (!companyName) return { ok: false, status: 403, error: "アカウントに会社名が未設定です。担当者にご連絡ください。" };
        return { ok: true, email, companyName, role: "client", name: metaName || null, status: "pending" };
      }
      return { ok: false, status: 403, error: hasBusinessApp ? "アカウントは承認待ちです。承認後にご利用いただけます。" : "ビジネスアカウントが未登録です。承認をお待ちいただくか、担当者にお問い合わせください。" };
    }

    if (u.status === "pending" && !opts?.allowPending) return { ok: false, status: 403, error: "アカウントは承認待ちです。承認後にご利用いただけます。" };
    if (u.status !== "active" && u.status !== "pending") return { ok: false, status: 403, error: "アカウントが無効化されています。担当者にお問い合わせください。" };
    // 法人系ロールのみ（admin/agent は社内の動作確認用に許可）。
    if (!["client", "partner", "admin", "agent"].includes(u.role)) {
      return { ok: false, status: 403, error: "このAPIは法人アカウント専用です。" };
    }
    const companyName = String(u.company_name ?? "").trim() || metaCompany;
    if (!companyName && (u.role === "client" || u.role === "partner")) {
      return { ok: false, status: 403, error: "アカウントに会社名が未設定です。担当者にご連絡ください。" };
    }
    return { ok: true, email, companyName: companyName || "ENGER", role: u.role, name: u.name ?? metaName ?? null, status: u.status === "active" ? "active" : "pending" };
  } catch (e) {
    return { ok: false, status: 500, error: e instanceof Error ? e.message : String(e) };
  }
}

/** ログイン状態の照会用（/api/public/me）。エラーにせず status を返す版。 */
export async function describeBusinessViewer(req: NextRequest): Promise<
  | { ok: true; email: string; status: BizStatus; companyName: string | null; name: string | null; role: string | null }
  | { ok: false; status: number; error: string }
> {
  const v = await resolveBusinessViewer(req, { allowPending: true });
  if (v.ok) return { ok: true, email: v.email, status: v.status, companyName: v.companyName || null, name: v.name, role: v.role };
  // 認証済みだが未登録（none）の区別：401 はそのまま、403 は none として返す（メニュー制御に使う）。
  if (v.status === 401) return { ok: false, status: 401, error: v.error };
  return { ok: false, status: v.status, error: v.error };
}
