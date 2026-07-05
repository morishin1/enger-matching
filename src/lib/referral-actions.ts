"use server";

// 紹介元ポータル（/ref）のサーバアクション。
//   refPortalLogin / refPortalLogout … 公開ページの簡易ログイン（ID＋パスコード → Cookie）
//   reactReferralMatch               … 良い/わるい判定（良い＝担当へ通知＋提案管理へ自動投入）
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

/** 良い/わるい判定（お試し企業向け）。judgement を記録し、
 *  「良い（want）」なら担当へ通知＋提案管理へ自動投入する（LP応募→提案と同じ方式）。
 *  ・kind: cand_job=紹介人材×案件 / job_cand=紹介案件×人材（どちらもペアは candidate_no × job_no）。
 *  ・再判定は上書き（見送り→やはり進めたい 等）。 */
export async function reactReferralMatch(formData: FormData): Promise<void> {
  const partner = await getRefSession();
  if (!partner) redirect("/ref?err=session");
  const candidateNo = Number(formData.get("candidate_no"));
  const jobNo = Number(formData.get("job_no"));
  const kind = String(formData.get("kind")) === "job_cand" ? "job_cand" : "cand_job";
  const verdict = String(formData.get("verdict")) === "pass" ? "pass" : "want";
  if (!Number.isFinite(candidateNo) || !Number.isFinite(jobNo)) redirect("/ref");

  let created = false;
  try {
    const admin = engerAdmin();
    // 判定を upsert（再判定で上書き）。verdict/kind 列未整備（referral-portal-v2.sql 未実行）の環境では
    //   従来どおりの insert（＝want 相当の記録）にフォールバックする。
    let up = await admin.from("referral_requests").upsert(
      { partner_id: partner.id, candidate_no: candidateNo, job_no: jobNo, kind, verdict, updated_at: new Date().toISOString() },
      { onConflict: "partner_id,candidate_no,job_no" },
    );
    if (up.error && /kind|verdict|updated_at|column/i.test(up.error.message ?? "")) {
      up = await admin.from("referral_requests").insert({ partner_id: partner.id, candidate_no: candidateNo, job_no: jobNo });
    }

    if (verdict === "want") {
      // 担当へ通知（ベル）。
      const pairLabel = `人材 P-${String(candidateNo).padStart(5, "0")} × 案件 No.${String(jobNo).padStart(5, "0")}`;
      const title = "紹介元ポータル：進めたい判定が届きました";
      const body = `${partner.company_name} が ${pairLabel} を「進めたい」と判定しました。提案管理（所属確認）に自動作成済みです。`;
      const rows: any[] = [{ recipient: "all", title, body, kind: "info" }];
      if (partner.created_by) rows.unshift({ recipient: partner.created_by, title, body, kind: "info" });
      try { await admin.from("notifications").insert(rows); } catch { /* 通知失敗は無視 */ }

      // 提案管理へ自動投入（DXの進捗管理に乗せる）。LP応募→提案（engineers/actions）と同じ軽量方式：
      //   ・candidate_no / job_no から実体を解決し、既存の提案があれば再作成しない（重複防止）。
      //   ・stage="所属確認"（ボード先頭）・proposer=null（KPIに紛れ込ませない）・next_action に出所を明記。
      try {
        const [cr, jr]: any[] = await Promise.all([
          admin.from("candidates").select("id, name, initials, rate").eq("candidate_no", candidateNo).maybeSingle(),
          admin.from("jobs").select("id, title, client_name").eq("job_no", jobNo).maybeSingle(),
        ]);
        const cand = cr?.data, job = jr?.data;
        if (cand?.id && job?.id) {
          const dup: any = await admin.from("proposals").select("id").eq("candidate_id", cand.id).eq("job_id", job.id).limit(1).maybeSingle();
          if (!dup?.data?.id) {
            const ins: any = await admin.from("proposals").insert({
              job_id: job.id, candidate_id: cand.id, stage: "所属確認",
              job_title: job.title ?? "（案件）", company: job.client_name ?? null,
              candidate_name: cand.name ?? null, c_init: cand.initials ?? null, rate: cand.rate ?? null,
              proposer: null, ai: false,
              next_action: `紹介元ポータル「進めたい」（${partner.company_name}）`,
            }).select("id").maybeSingle();
            const pid = ins?.data?.id ?? null;
            created = !!pid;
            if (pid) {
              try {
                await admin.from("proposal_memos").insert({
                  proposal_id: pid,
                  category: kind === "job_cand" ? "案件側→当社" : "人材側→当社",
                  body: `【自動記録】紹介元ポータル（${partner.company_name}）が「進めたい」と判定したため作成。担当が所属確認から進めてください。`,
                  created_by_email: null, created_by_name: "自動記録（紹介元ポータル）",
                });
              } catch { /* メモ失敗は提案作成を止めない */ }
            }
          }
        }
      } catch { /* proposals 未整備でも判定記録は成立させる */ }
    }
  } catch { /* noop */ }
  redirect(verdict === "want" ? (created ? "/ref?req=ok" : "/ref?req=want") : "/ref?req=pass");
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
