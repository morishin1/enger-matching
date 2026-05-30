"use server";

import { randomBytes } from "crypto";
import { revalidatePath, revalidateTag } from "next/cache";
import { engerAdmin, authAdmin } from "@/lib/supabase";
import { authServerClient, authConfigured } from "@/lib/supabase-auth";
import { resolveAccess } from "@/lib/accounts";

type Result = { ok: boolean; error?: string };

/** アカウント変更時：提案者/クロージング候補（getStaff）のキャッシュも更新。 */
const bustMembers = () => { revalidateTag("staff", "max"); revalidatePath("/settings"); };

/** 紛らわしい文字を除いた強固な仮パスワード（記号・数字を必ず含む、約16桁）。 */
function genTempPassword(): string {
  const charset = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = randomBytes(14);
  let s = "";
  for (let i = 0; i < 14; i++) s += charset[bytes[i] % charset.length];
  return s + "@7"; // 記号+数字を保証
}

/** email から Supabase 認証ユーザーの id を解決（service role）。 */
async function findAuthUserIdByEmail(email: string): Promise<string | null> {
  const target = email.toLowerCase().trim();
  const admin = authAdmin();
  for (let page = 1; page <= 5; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error || !data) return null;
    const hit = data.users.find((u) => (u.email ?? "").toLowerCase() === target);
    if (hit) return hit.id;
    if (data.users.length < 1000) break;
  }
  return null;
}

/** 操作者が admin であることを確認。 */
async function requireAdmin(): Promise<Result> {
  if (!authConfigured) return { ok: true }; // ローカル(認証未設定)は許可
  try {
    const sb = await authServerClient();
    const { data: { user } } = await sb.auth.getUser();
    const access = user?.email ? await resolveAccess(user.email) : null;
    if (access?.role === "admin" && access.status === "active") return { ok: true };
    return { ok: false, error: "管理者権限が必要です" };
  } catch (e: any) { return { ok: false, error: String(e?.message ?? e) }; }
}

/** 承認: status=active + role/company を確定。 */
export async function approveAccount(formData: FormData): Promise<Result> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard;
  const id = String(formData.get("id") ?? "");
  const role = String(formData.get("role") ?? "client");
  const company = String(formData.get("company_name") ?? "").trim() || null;
  if (!id) return { ok: false, error: "id がありません" };
  try {
    const sb = engerAdmin();
    const { error } = await sb.from("app_users").update({
      status: "active",
      role: ["admin", "agent", "client", "candidate", "partner", "freelance"].includes(role) ? role : "client",
      company_name: company,
      approved_at: new Date().toISOString(),
    }).eq("id", id);
    if (error) return { ok: false, error: error.message };
    bustMembers();
    return { ok: true };
  } catch (e: any) { return { ok: false, error: String(e?.message ?? e) }; }
}

/** 面談済みフラグ：詳細閲覧の解放/再制限。 */
export async function setAccountMeetingDone(id: string, done: boolean): Promise<Result> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard;
  if (!id) return { ok: false, error: "id がありません" };
  try {
    const sb = engerAdmin();
    let r: any = await sb.from("app_users").update({ meeting_done: done, meeting_done_at: done ? new Date().toISOString() : null }).eq("id", id);
    if (r.error && /meeting_done|column/i.test(r.error.message)) {
      // 列が未追加の環境はフォールバック（何もしない）
      return { ok: false, error: "面談済み列が未追加です（supabase/account-meeting-done.sql を実行してください）" };
    }
    if (r.error) return { ok: false, error: r.error.message };
    bustMembers();
    return { ok: true };
  } catch (e: any) { return { ok: false, error: String(e?.message ?? e) }; }
}

/** ステータス変更（無効化 / 再有効化）。 */
export async function setAccountStatus(id: string, status: "active" | "disabled"): Promise<Result> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard;
  if (!id) return { ok: false, error: "id がありません" };
  try {
    const sb = engerAdmin();
    const { error } = await sb.from("app_users").update({ status }).eq("id", id);
    if (error) return { ok: false, error: error.message };
    bustMembers();
    return { ok: true };
  } catch (e: any) { return { ok: false, error: String(e?.message ?? e) }; }
}

/** ロール変更。 */
export async function setAccountRole(id: string, role: "admin" | "agent" | "client" | "candidate" | "partner" | "freelance"): Promise<Result> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard;
  if (!id) return { ok: false, error: "id がありません" };
  try {
    const sb = engerAdmin();
    const { error } = await sb.from("app_users").update({ role }).eq("id", id);
    if (error) return { ok: false, error: error.message };
    bustMembers();
    return { ok: true };
  } catch (e: any) { return { ok: false, error: String(e?.message ?? e) }; }
}

/** 職能（複数）を管理者が設定。 */
export async function setAccountFunctions(id: string, functions: string[]): Promise<Result> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard;
  if (!id) return { ok: false, error: "id がありません" };
  try {
    const sb = engerAdmin();
    const { error } = await sb.from("app_users").update({ functions }).eq("id", id);
    if (error) return { ok: false, error: error.message };
    bustMembers();
    revalidatePath("/");
    return { ok: true };
  } catch (e: any) { return { ok: false, error: String(e?.message ?? e) }; }
}

/** 営業区分（インサイド/アウトサイド）を管理者が設定。 */
export async function setAccountPosition(id: string, position: "inside" | "outside" | null): Promise<Result> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard;
  if (!id) return { ok: false, error: "id がありません" };
  try {
    const sb = engerAdmin();
    const { error } = await sb.from("app_users").update({ position }).eq("id", id);
    if (error) return { ok: false, error: error.message };
    bustMembers();
    revalidatePath("/");
    return { ok: true };
  } catch (e: any) { return { ok: false, error: String(e?.message ?? e) }; }
}

/**
 * 管理者がエージェント等を新規作成。
 *  - Supabase 認証ユーザーを作成（仮パスワード自動生成・メール確認済み扱い）
 *  - enger.app_users を active で登録（role/職能/区分）
 *  返り値の password は「1回だけ」画面に表示し、本人に伝達して初回ログイン後に変更してもらう。
 */
export async function createAgent(formData: FormData): Promise<Result & { password?: string; email?: string }> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard;

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const name = String(formData.get("name") ?? "").trim() || null;
  const roleRaw = String(formData.get("role") ?? "agent");
  const role = (["admin", "agent", "client"].includes(roleRaw) ? roleRaw : "agent") as "admin" | "agent" | "client";
  const positionRaw = String(formData.get("position") ?? "");
  const position = positionRaw === "inside" || positionRaw === "outside" ? positionRaw : null;
  const functions = formData.getAll("functions").map(String).filter(Boolean);
  const company = String(formData.get("company_name") ?? "").trim() || null;

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: "メールアドレスの形式が正しくありません" };

  const password = genTempPassword();
  try {
    // 1) 認証ユーザー作成
    const auth = authAdmin();
    const { error: authErr } = await auth.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: name ? { full_name: name } : undefined,
    });
    if (authErr) {
      if (/registered|already|exists/i.test(authErr.message)) {
        return { ok: false, error: "このメールは既に登録済みです。一覧の「パスワード再発行」をご利用ください。" };
      }
      return { ok: false, error: authErr.message };
    }

    // 2) アプリ権限レコード（active）
    const sb = engerAdmin();
    const { error: dbErr } = await sb.from("app_users").upsert({
      email,
      name,
      role,
      status: "active",
      position,
      functions,
      company_name: company,
      approved_at: new Date().toISOString(),
    }, { onConflict: "email" });
    if (dbErr) return { ok: false, error: `認証ユーザーは作成しましたが権限登録に失敗: ${dbErr.message}` };

    bustMembers();
    return { ok: true, password, email };
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e) };
  }
}

/** 管理者がパスワードを再発行（新しい仮パスワードを設定して1回だけ表示）。 */
export async function resetAccountPassword(email: string): Promise<Result & { password?: string }> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard;
  const e = (email || "").trim().toLowerCase();
  if (!e) return { ok: false, error: "メールがありません" };
  try {
    const uid = await findAuthUserIdByEmail(e);
    if (!uid) return { ok: false, error: "認証ユーザーが見つかりません（このアカウントはまだログイン用パスワードが未発行の可能性があります）" };
    const password = genTempPassword();
    const { error } = await authAdmin().auth.admin.updateUserById(uid, { password });
    if (error) return { ok: false, error: error.message };
    return { ok: true, password };
  } catch (err: any) {
    return { ok: false, error: String(err?.message ?? err) };
  }
}

/** アカウント削除。 */
export async function deleteAccount(id: string): Promise<Result> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard;
  if (!id) return { ok: false, error: "id がありません" };
  try {
    const sb = engerAdmin();
    const { error } = await sb.from("app_users").delete().eq("id", id);
    if (error) return { ok: false, error: error.message };
    bustMembers();
    return { ok: true };
  } catch (e: any) { return { ok: false, error: String(e?.message ?? e) }; }
}
