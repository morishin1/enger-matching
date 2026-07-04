"use server";

// 紹介元ポータル（/ref）のサーバアクション。
//   refPortalLogin / refPortalLogout … 公開ページの簡易ログイン（ID＋パスコード → Cookie）
//   requestReferralProposal          … 「この案件で進めてほしい」依頼（担当へ通知）
//   issueReferralPortal ほか         … 担当（admin/agent）による発行・パスコード再発行・停止
import { randomInt } from "crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { currentAccess } from "@/lib/accounts";
import { engerAdmin } from "@/lib/supabase";
import {
  REF_COOKIE, REF_EXPIRE_DAYS, REF_MAX_FAILED_ATTEMPTS,
  getRefPartnerByLoginId, getRefSession, refCookieValue, refPartnerState, refPasscodeHash,
} from "@/lib/referral";

/** 公開ページの簡易ログイン（<form action> から呼ぶ）。成功で Cookie を置いて /ref へ。 */
export async function refPortalLogin(formData: FormData): Promise<void> {
  const loginId = String(formData.get("login_id") ?? "").trim().toUpperCase();
  const passcode = String(formData.get("passcode") ?? "").trim();
  if (!loginId || !passcode) redirect("/ref?err=input");

  const p = await getRefPartnerByLoginId(loginId);
  if (!p) redirect("/ref?err=login");
  const state = refPartnerState(p);
  if (state === "locked") redirect("/ref?err=locked");
  if (state !== "ok") redirect("/ref?err=login");

  if (refPasscodeHash(loginId, passcode) !== p.passcode_hash) {
    // 失敗：カウントを進める（上限で自動ロック＝担当による再発行が必要）。
    try {
      const admin = engerAdmin();
      await admin.from("referral_partners").update({ failed_attempts: (p.failed_attempts ?? 0) + 1 }).eq("id", p.id);
    } catch { /* noop */ }
    redirect((p.failed_attempts ?? 0) + 1 >= REF_MAX_FAILED_ATTEMPTS ? "/ref?err=locked" : "/ref?err=login");
  }

  // 成功：失敗カウントをリセットして Cookie を発行。
  try {
    const admin = engerAdmin();
    if ((p.failed_attempts ?? 0) > 0) await admin.from("referral_partners").update({ failed_attempts: 0 }).eq("id", p.id);
  } catch { /* noop */ }
  const store = await cookies();
  const maxAge = p.expires_at
    ? Math.max(60, Math.floor((new Date(p.expires_at).getTime() - Date.now()) / 1000))
    : REF_EXPIRE_DAYS * 86400;
  store.set(REF_COOKIE, refCookieValue(p), {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/ref", maxAge,
  });
  redirect("/ref");
}

export async function refPortalLogout(): Promise<void> {
  const store = await cookies();
  store.set(REF_COOKIE, "", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/ref", maxAge: 0 });
  redirect("/ref");
}

/** 「この案件で進めてほしい」依頼。記録して担当のお知らせ（ベル）へ通知する。 */
export async function requestReferralProposal(formData: FormData): Promise<void> {
  const partner = await getRefSession();
  if (!partner) redirect("/ref?err=session");
  const candidateNo = Number(formData.get("candidate_no"));
  const jobNo = Number(formData.get("job_no"));
  if (!Number.isFinite(candidateNo) || !Number.isFinite(jobNo)) redirect("/ref");

  try {
    const admin = engerAdmin();
    // 重複依頼は unique 制約で弾く（エラーは握って「依頼済み」表示に任せる）。
    const ins = await admin.from("referral_requests").insert({ partner_id: partner.id, candidate_no: candidateNo, job_no: jobNo });
    if (!ins.error) {
      const title = "紹介元から提案依頼が届きました";
      const body = `${partner.company_name} が 人材 P-${String(candidateNo).padStart(5, "0")} を案件 No.${String(jobNo).padStart(5, "0")} で進めてほしいと依頼しました（紹介元ポータル）。`;
      const rows: any[] = [{ recipient: "all", title, body, kind: "info" }];
      if (partner.created_by) rows.unshift({ recipient: partner.created_by, title, body, kind: "info" });
      try { await admin.from("notifications").insert(rows); } catch { /* 通知失敗は無視 */ }
    }
  } catch { /* noop */ }
  redirect("/ref?req=ok");
}

// ---- 担当（admin/agent）向け：発行・再発行・停止 ------------------------------

type StaffGate = { ok: true; admin: ReturnType<typeof engerAdmin>; name: string } | { ok: false; error: string };
async function staffGate(): Promise<StaffGate> {
  const access = await currentAccess();
  if (!access || (access.role !== "admin" && access.role !== "agent")) {
    return { ok: false, error: "権限がありません（管理者またはエージェントのみ）" };
  }
  try { return { ok: true, admin: engerAdmin(), name: access.name ?? access.email ?? "担当" }; }
  catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }
}

const tableMissing = (msg: string) => /referral_partners|referral_requests|schema cache|does not exist/i.test(msg);
const TABLE_HINT = "紹介元ポータルの台帳が未作成です（supabase/referral-partners.sql を実行してください）";

/** 紛らわしい文字（0/O・1/l 等）を除いたパスコード8桁を生成。 */
function genPasscode(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  let s = "";
  for (let i = 0; i < 8; i++) s += alphabet[randomInt(0, alphabet.length)];
  return s;
}

export type ReferralPortalInfo = {
  exists: boolean;
  loginId?: string;
  active?: boolean;          // 停止・期限切れ・ロックでない
  state?: "ok" | "revoked" | "expired" | "locked";
  expiresAt?: string | null;
  viewCount?: number;
  lastViewedAt?: string | null;
  requestCount?: number;     // 「進めてほしい」依頼数
};

/** 企業に紐づく紹介元ポータルの現況（企業管理の詳細モーダル用）。 */
export async function getReferralPortalInfo(company: string): Promise<{ ok: boolean; info?: ReferralPortalInfo; error?: string }> {
  const g = await staffGate();
  if (!g.ok) return { ok: false, error: g.error };
  const name = company.trim();
  if (!name) return { ok: false, error: "企業名がありません" };
  try {
    const r: any = await g.admin.from("referral_partners")
      .select("id, login_id, expires_at, revoked_at, failed_attempts, view_count, last_viewed_at")
      .eq("company_name", name).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (r.error) return { ok: false, error: tableMissing(String(r.error.message)) ? TABLE_HINT : String(r.error.message) };
    const p = r.data;
    if (!p) return { ok: true, info: { exists: false } };
    const state = refPartnerState(p);
    let requestCount = 0;
    try {
      const rq: any = await g.admin.from("referral_requests").select("id", { count: "exact", head: true }).eq("partner_id", p.id);
      requestCount = rq.count ?? 0;
    } catch { /* noop */ }
    return {
      ok: true,
      info: {
        exists: true, loginId: p.login_id, active: state === "ok", state,
        expiresAt: p.expires_at ?? null, viewCount: p.view_count ?? 0, lastViewedAt: p.last_viewed_at ?? null,
        requestCount,
      },
    };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}

/** 発行／パスコード再発行。既存行があれば同じ ID のままパスコードだけ更新（先方に伝えた ID を変えない）。
 *  パスコードは戻り値で一度だけ返す（保存はハッシュのみ）。 */
export async function issueReferralPortal(company: string): Promise<{ ok: boolean; loginId?: string; passcode?: string; url?: string; expiresAt?: string; error?: string }> {
  const g = await staffGate();
  if (!g.ok) return { ok: false, error: g.error };
  const name = company.trim();
  if (!name) return { ok: false, error: "企業名がありません" };

  const base = (process.env.NEXT_PUBLIC_SITE_URL || "https://dx.enger.jp").replace(/\/$/, "");
  const passcode = genPasscode();
  const expiresAt = new Date(Date.now() + REF_EXPIRE_DAYS * 86400000).toISOString();

  try {
    // 既存行（最新）を再利用：login_id を維持してパスコード更新・ロック解除・停止解除・期限延長。
    const cur: any = await g.admin.from("referral_partners")
      .select("id, login_id").eq("company_name", name).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (cur.error) return { ok: false, error: tableMissing(String(cur.error.message)) ? TABLE_HINT : String(cur.error.message) };
    if (cur.data) {
      const loginId = cur.data.login_id as string;
      const up = await g.admin.from("referral_partners")
        .update({ passcode_hash: refPasscodeHash(loginId, passcode), failed_attempts: 0, revoked_at: null, expires_at: expiresAt })
        .eq("id", cur.data.id);
      if (up.error) return { ok: false, error: String(up.error.message) };
      return { ok: true, loginId, passcode, url: `${base}/ref`, expiresAt };
    }

    // 新規発行：REF-XXXX（重複時はリトライ）。
    for (let i = 0; i < 6; i++) {
      const loginId = `REF-${String(randomInt(0, 10000)).padStart(4, "0")}`;
      const ins = await g.admin.from("referral_partners").insert({
        login_id: loginId, passcode_hash: refPasscodeHash(loginId, passcode),
        company_name: name, created_by: g.name, expires_at: expiresAt,
      });
      if (!ins.error) return { ok: true, loginId, passcode, url: `${base}/ref`, expiresAt };
      if (!/duplicate|unique/i.test(String(ins.error.message))) {
        return { ok: false, error: tableMissing(String(ins.error.message)) ? TABLE_HINT : String(ins.error.message) };
      }
    }
    return { ok: false, error: "ID の採番に失敗しました。もう一度お試しください。" };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}

/** 停止（即時失効）。再開はパスコード再発行で行う。 */
export async function revokeReferralPortal(company: string): Promise<{ ok: boolean; error?: string }> {
  const g = await staffGate();
  if (!g.ok) return { ok: false, error: g.error };
  const name = company.trim();
  if (!name) return { ok: false, error: "企業名がありません" };
  try {
    const up = await g.admin.from("referral_partners").update({ revoked_at: new Date().toISOString() }).eq("company_name", name).is("revoked_at", null);
    if (up.error) return { ok: false, error: tableMissing(String(up.error.message)) ? TABLE_HINT : String(up.error.message) };
    return { ok: true };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}
