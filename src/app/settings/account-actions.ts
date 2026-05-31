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

type Actor = { email: string; name: string | null; role: string };
const localActor: Actor = { email: "local-admin", name: null, role: "admin" };

/** 現在の操作者情報を取得（ロール判定と監査用）。 */
async function getActor(): Promise<Actor | null> {
  if (!authConfigured) return localActor;
  try {
    const sb = await authServerClient();
    const { data: { user } } = await sb.auth.getUser();
    if (!user?.email) return null;
    const access = await resolveAccess(user.email);
    if (!access || access.status !== "active") return null;
    return { email: user.email, name: access.name, role: access.role };
  } catch { return null; }
}

/** 操作者が admin であることを確認。 */
async function requireAdmin(): Promise<Result & { actor?: Actor }> {
  const actor = await getActor();
  if (!actor) return { ok: false, error: "認証が必要です" };
  if (actor.role !== "admin") return { ok: false, error: "管理者権限が必要です" };
  return { ok: true, actor };
}

/** 操作者が admin または agent であることを確認（承認・面談済み・無効化・区分変更などの軽い管理操作向け）。 */
async function requireAdminOrAgent(): Promise<Result & { actor?: Actor }> {
  const actor = await getActor();
  if (!actor) return { ok: false, error: "認証が必要です" };
  if (actor.role !== "admin" && actor.role !== "agent") return { ok: false, error: "管理者またはエージェントの権限が必要です" };
  return { ok: true, actor };
}

/** 監査ログを残す（失敗は無視）。 */
async function audit(targetId: string, targetEmail: string | null, action: string, detail: string | null, actor: Actor) {
  try {
    const sb = engerAdmin();
    await sb.from("account_audits").insert({
      target_id: targetId, target_email: targetEmail,
      action, detail,
      actor_email: actor.email, actor_name: actor.name, actor_role: actor.role,
    });
  } catch { /* 監査テーブル未作成等は無視 */ }
}

/** 承認: status=active + role/company を確定。 */
export async function approveAccount(formData: FormData): Promise<Result> {
  // 承認はエージェントも実行可（admin が admin ロール付与する操作とは分離）
  const guard = await requireAdminOrAgent();
  if (!guard.ok) return guard;
  const actor = guard.actor!;
  const id = String(formData.get("id") ?? "");
  const role = String(formData.get("role") ?? "client");
  const company = String(formData.get("company_name") ?? "").trim() || null;
  if (!id) return { ok: false, error: "id がありません" };
  // エージェントは admin ロール付与不可（権限昇格防止）
  if (role === "admin" && actor.role !== "admin") return { ok: false, error: "管理者ロールの付与は管理者のみ実行できます" };
  // LP登録(public.profiles または auth.users)からの承認は、まず app_users に挿入してから処理する
  if (id.startsWith("profile:") || id.startsWith("auth:")) {
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const name = String(formData.get("name") ?? "").trim() || null;
    if (!email) return { ok: false, error: "メールアドレスがありません" };
    try {
      const sb0 = engerAdmin();
      // 既存重複は無視
      const ex = await sb0.from("app_users").select("id").ilike("email", email).maybeSingle();
      let newId: string | null = ex.data?.id ?? null;
      if (!newId) {
        const ins: any = await sb0.from("app_users").insert({ email, name, role: "candidate", status: "pending" }).select("id").maybeSingle();
        if (ins.error) return { ok: false, error: ins.error.message };
        newId = ins.data?.id ?? null;
      }
      if (!newId) return { ok: false, error: "アカウント作成に失敗しました" };
      // 後段の更新で active 化
      const fd2 = new FormData();
      fd2.set("id", newId);
      fd2.set("role", ["admin", "agent", "client", "candidate", "partner", "freelance"].includes(role) ? role : "candidate");
      if (company) fd2.set("company_name", company);
      return approveAccount(fd2);
    } catch (e: any) { return { ok: false, error: String(e?.message ?? e) }; }
  }
  try {
    const sb = engerAdmin();
    const upd: Record<string, any> = {
      status: "active",
      role: ["admin", "agent", "client", "candidate", "partner", "freelance"].includes(role) ? role : "client",
      company_name: company,
      approved_at: new Date().toISOString(),
      approved_by_email: actor.email,
      approved_by_name: actor.name,
    };
    let { error } = await sb.from("app_users").update(upd).eq("id", id);
    // approved_by_* 列が無い環境でも落ちないようフォールバック
    if (error && /approved_by|column/i.test(error.message)) {
      delete upd.approved_by_email; delete upd.approved_by_name;
      ({ error } = await sb.from("app_users").update(upd).eq("id", id));
    }
    if (error) return { ok: false, error: error.message };
    await audit(id, null, "approve", `role=${upd.role}${company ? ` company=${company}` : ""}`, actor);
    bustMembers();
    return { ok: true };
  } catch (e: any) { return { ok: false, error: String(e?.message ?? e) }; }
}

/** 面談済みフラグ：詳細閲覧の解放/再制限。 */
export async function setAccountMeetingDone(id: string, done: boolean): Promise<Result> {
  const guard = await requireAdminOrAgent();
  if (!guard.ok) return guard;
  const actor = guard.actor!;
  if (!id) return { ok: false, error: "id がありません" };
  try {
    const sb = engerAdmin();
    const upd: Record<string, any> = {
      meeting_done: done,
      meeting_done_at: done ? new Date().toISOString() : null,
      meeting_done_by_email: done ? actor.email : null,
      meeting_done_by_name: done ? actor.name : null,
    };
    let r: any = await sb.from("app_users").update(upd).eq("id", id);
    if (r.error && /meeting_done_by|column/i.test(r.error.message)) {
      delete upd.meeting_done_by_email; delete upd.meeting_done_by_name;
      r = await sb.from("app_users").update(upd).eq("id", id);
    }
    if (r.error && /meeting_done|column/i.test(r.error.message)) {
      return { ok: false, error: "面談済み列が未追加です（supabase/account-meeting-done.sql を実行してください）" };
    }
    if (r.error) return { ok: false, error: r.error.message };
    await audit(id, null, done ? "meeting_done_on" : "meeting_done_off", null, actor);
    bustMembers();
    return { ok: true };
  } catch (e: any) { return { ok: false, error: String(e?.message ?? e) }; }
}

/** ステータス変更（無効化 / 再有効化）。 */
export async function setAccountStatus(id: string, status: "active" | "disabled"): Promise<Result> {
  const guard = await requireAdminOrAgent();
  if (!guard.ok) return guard;
  const actor = guard.actor!;
  if (!id) return { ok: false, error: "id がありません" };
  try {
    const sb = engerAdmin();
    const { error } = await sb.from("app_users").update({ status }).eq("id", id);
    if (error) return { ok: false, error: error.message };
    await audit(id, null, status === "active" ? "status_active" : "status_disabled", null, actor);
    bustMembers();
    return { ok: true };
  } catch (e: any) { return { ok: false, error: String(e?.message ?? e) }; }
}

/** ロール変更。エージェントも操作可能だが、admin への昇格は admin のみ。 */
export async function setAccountRole(id: string, role: "admin" | "agent" | "client" | "candidate" | "partner" | "freelance"): Promise<Result> {
  const guard = await requireAdminOrAgent();
  if (!guard.ok) return guard;
  const actor = guard.actor!;
  if (!id) return { ok: false, error: "id がありません" };
  if (role === "admin" && actor.role !== "admin") return { ok: false, error: "管理者ロールの付与は管理者のみ実行できます" };
  try {
    const sb = engerAdmin();
    const { error } = await sb.from("app_users").update({ role }).eq("id", id);
    if (error) return { ok: false, error: error.message };
    await audit(id, null, "role_change", `role=${role}`, actor);
    bustMembers();
    return { ok: true };
  } catch (e: any) { return { ok: false, error: String(e?.message ?? e) }; }
}

/** 担当エージェントを割り当て。誰がフォローするかを明確化。 */
export async function setAccountOwnerAgent(id: string, email: string | null, name: string | null): Promise<Result> {
  const guard = await requireAdminOrAgent();
  if (!guard.ok) return guard;
  const actor = guard.actor!;
  if (!id) return { ok: false, error: "id がありません" };
  try {
    const sb = engerAdmin();
    let r: any = await sb.from("app_users").update({ owner_agent_email: email, owner_agent_name: name }).eq("id", id);
    if (r.error && /owner_agent|column/i.test(r.error.message)) {
      return { ok: false, error: "担当エージェント列が未追加です（supabase/account-agent-owner.sql を実行してください）" };
    }
    if (r.error) return { ok: false, error: r.error.message };
    await audit(id, null, "owner_agent", email ? `assigned=${email}` : "cleared", actor);
    bustMembers();
    return { ok: true };
  } catch (e: any) { return { ok: false, error: String(e?.message ?? e) }; }
}

/** メモ（承認・面談の根拠／やり取り履歴）を保存。 */
export async function setAccountNote(id: string, note: string): Promise<Result> {
  const guard = await requireAdminOrAgent();
  if (!guard.ok) return guard;
  const actor = guard.actor!;
  if (!id) return { ok: false, error: "id がありません" };
  try {
    const sb = engerAdmin();
    const { error } = await sb.from("app_users").update({ note: note?.trim() || null }).eq("id", id);
    if (error) return { ok: false, error: error.message };
    await audit(id, null, "note", note ? "updated" : "cleared", actor);
    bustMembers();
    return { ok: true };
  } catch (e: any) { return { ok: false, error: String(e?.message ?? e) }; }
}

/** 職能（複数）を管理者が設定。 */
/** クライアントからの活動取得（送信メール＋打合せ）。 */
export async function getAccountActivity(accountId: string): Promise<{ ok: true; emails: any[]; meetings: any[] } | { ok: false; error: string }> {
  const guard = await requireAdminOrAgent();
  if (!guard.ok) return { ok: false, error: guard.error ?? "権限が必要です" };
  try {
    const { listAccountActivity } = await import("@/lib/accounts");
    const d = await listAccountActivity(accountId);
    return { ok: true, emails: d.emails, meetings: d.meetings };
  } catch (e: any) { return { ok: false, error: String(e?.message ?? e) }; }
}

/** 承認待ちユーザーへのメール送信を記録（実送信は Gmail コンポーズURLで担当が行う）。 */
export async function logAccountEmail(input: { account_id: string; account_email: string; template: string; subject: string; body: string }): Promise<Result> {
  const guard = await requireAdminOrAgent();
  if (!guard.ok) return guard;
  const actor = guard.actor!;
  if (!input.account_id || !input.subject) return { ok: false, error: "必要項目が不足しています" };
  try {
    const sb = engerAdmin();
    const { error } = await sb.from("account_emails").insert({
      account_id: input.account_id,
      account_email: input.account_email,
      template: input.template,
      subject: input.subject,
      body: input.body,
      actor_email: actor.email,
      actor_name: actor.name,
      status: "sent",
    });
    if (error) return { ok: false, error: error.message };
    await audit(input.account_id, input.account_email, "email_sent", `tpl=${input.template}`, actor);
    return { ok: true };
  } catch (e: any) { return { ok: false, error: String(e?.message ?? e) }; }
}

/** アカウントに紐づく打合せ予定/実績を1件記録（連動：面談実施 → 後に承認/面談済み）。 */
export async function createAccountMeeting(input: { account_id: string; account_email: string; meeting_date: string; title?: string; our_owner?: string; new_or_existing?: string; needs?: string }): Promise<Result> {
  const guard = await requireAdminOrAgent();
  if (!guard.ok) return guard;
  const actor = guard.actor!;
  if (!input.account_id || !input.meeting_date) return { ok: false, error: "必要項目が不足しています" };
  try {
    const sb = engerAdmin();
    const row: Record<string, any> = {
      title: input.title?.trim() || `面談（${input.account_email}）`,
      meeting_date: input.meeting_date,
      our_owner: input.our_owner ?? actor.name ?? null,
      new_or_existing: input.new_or_existing || "新規",
      needs: input.needs ?? null,
      account_id: input.account_id,
      account_email: input.account_email,
    };
    let r: any = await sb.from("meetings").insert(row);
    if (r.error && /account_id|account_email|column/i.test(r.error.message)) {
      // 列未追加環境は account_* 抜きで保存
      delete row.account_id; delete row.account_email;
      r = await sb.from("meetings").insert(row);
    }
    if (r.error) return { ok: false, error: r.error.message };
    await audit(input.account_id, input.account_email, "meeting_scheduled", `date=${input.meeting_date}`, actor);
    bustMembers();
    revalidatePath("/meetings");
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
