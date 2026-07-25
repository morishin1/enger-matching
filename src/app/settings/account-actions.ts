"use server";

import { randomBytes } from "crypto";
import { revalidatePath, revalidateTag } from "next/cache";
import { engerAdmin, authAdmin, publicAdmin } from "@/lib/supabase";
import { authServerClient, authConfigured } from "@/lib/supabase-auth";
import { resolveAccess } from "@/lib/accounts";
import { markBusinessAuthApp } from "@/lib/auth-apps";
import { prepareCandidateFromFreelancer, registerCandidateFromFreelancer, setEngineerMeetingDone } from "@/app/engineers/actions";

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

/** Supabase Auth に email のユーザーが居なければ新規作成し、id を返す。
 *  これをしないと「app_users で active 表示なのにログインできない」状態になる
 *  （承認時に auth 側を作らなかった過去ケースの救済）。
 *  既に居れば既存 id を返す（パスワードは変更しない）。 */
async function ensureAuthUser(email: string, opts?: { password?: string; name?: string | null }): Promise<{ id: string | null; created: boolean; error?: string }> {
  const e = (email || "").trim().toLowerCase();
  if (!e) return { id: null, created: false, error: "メールが空です" };
  const exists = await findAuthUserIdByEmail(e);
  if (exists) return { id: exists, created: false };
  try {
    const aa = authAdmin();
    const { data, error } = await aa.auth.admin.createUser({
      email: e,
      password: opts?.password ?? genTempPassword(),
      email_confirm: true,
      user_metadata: opts?.name ? { full_name: opts.name } : undefined,
    });
    if (error) {
      // 「既に登録済み」等のレース時は再検索して既存を返す（成功扱い）
      if (/registered|already|exists|duplicate/i.test(error.message)) {
        const again = await findAuthUserIdByEmail(e);
        if (again) return { id: again, created: false };
      }
      return { id: null, created: false, error: error.message };
    }
    return { id: data.user?.id ?? null, created: true };
  } catch (err: any) { return { id: null, created: false, error: String(err?.message ?? err) }; }
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
  const role = String(formData.get("role") ?? "");
  const company = String(formData.get("company_name") ?? "").trim() || null;
  if (!id) return { ok: false, error: "id がありません" };
  // エージェントは admin ロール「付与」不可（権限昇格防止）。
  //   ただし「既に admin の人を active に戻すだけ」のケースまでブロックすると
  //   既存管理者の有効化ができなくなるため、ここでは「明示的に admin を指定した
  //   昇格操作」だけ拒否する。
  if (role === "admin" && actor.role !== "admin") return { ok: false, error: "管理者ロールの付与は管理者のみ実行できます" };
  // LP登録(public.profiles または auth.users)からの承認は、まず app_users に挿入してから処理する
  if (id.startsWith("profile:") || id.startsWith("auth:")) {
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const name = String(formData.get("name") ?? "").trim() || null;
    if (!email) return { ok: false, error: "メールアドレスがありません" };
    try {
      const sb0 = engerAdmin();
      // 既存 app_users との重複チェック。
      //   ★重要：既に内部ロール（admin/agent/partner/freelance/client）で登録済みの
      //     メールアドレスに対して、LP の candidate 経由で同名行を承認すると、
      //     既存ロールを candidate に上書きしてしまう事故が起きていた
      //     （管理者を承認したのに「人材ダッシュボード」が表示される）。
      //   既存がある場合は、形だけ active 化するのみで「ロール変更は一切しない」。
      const ex: any = await sb0.from("app_users").select("id, role, status").ilike("email", email).maybeSingle();
      if (ex?.data?.id) {
        const existingRole = ex.data.role as string | null;
        const existingStatus = ex.data.status as string | null;
        // 既存が無効化（disabled）なら、UI 上で意図的に再有効化されるべき。LP 経由では触らない。
        if (existingStatus === "disabled") {
          return { ok: false, error: `${email} は無効化済みのアカウントです。ユーザー管理から手動で「有効化」してください。` };
        }
        if (existingStatus === "active") {
          return { ok: true }; // 既に有効。何もしない（ロール降格を防止）。
        }
        // pending のみ active へ（ロールは既存を維持）
        const upd: Record<string, any> = { status: "active", approved_at: new Date().toISOString(), approved_by_email: actor.email, approved_by_name: actor.name };
        let r: any = await sb0.from("app_users").update(upd).eq("id", ex.data.id);
        if (r.error && /approved_by|column/i.test(r.error.message)) {
          delete upd.approved_by_email; delete upd.approved_by_name;
          r = await sb0.from("app_users").update(upd).eq("id", ex.data.id);
        }
        if (r.error) return { ok: false, error: r.error.message };
        await audit(ex.data.id, email, "approve_existing", `kept role=${existingRole}`, actor);
        bustMembers();
        return { ok: true };
      }
      // 既存無し：新規 app_users 行を candidate で作成 → 後段の UPDATE で role を確定する。
      const ins: any = await sb0.from("app_users").insert({ email, name, role: "candidate", status: "pending" }).select("id").maybeSingle();
      if (ins.error) return { ok: false, error: ins.error.message };
      const newId: string | null = ins.data?.id ?? null;
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
    // 既存ロールを取得し、フォームの role が空・不正・既定値 "client" の場合は既存を維持する
    // （UI が role を送らない承認操作で、管理者→client/candidate に降格する事故を防ぐ）。
    const cur: any = await sb.from("app_users").select("role").eq("id", id).maybeSingle();
    const existingRole = (cur?.data?.role ?? null) as string | null;
    const explicitRole = String(formData.get("role") ?? "").trim();
    const validRoles = ["admin", "agent", "client", "candidate", "partner", "freelance"] as const;
    const finalRole = (explicitRole && (validRoles as readonly string[]).includes(explicitRole))
      ? explicitRole
      : (existingRole && (validRoles as readonly string[]).includes(existingRole) ? existingRole : "client");
    const upd: Record<string, any> = {
      status: "active",
      role: finalRole,
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

    // ログインに必要な Supabase auth.users を確実に作る（不在ならここで作成）。
    //   これをしないと「app_users で active 表示なのにログイン不可」状態になる。
    //   既存ユーザーは触らない（パスワードは上書きしない）。
    try {
      const { data: u } = await sb.from("app_users").select("email, name").eq("id", id).maybeSingle();
      const emailRow = (u as any)?.email as string | undefined;
      const nameRow = (u as any)?.name as string | undefined;
      if (emailRow) {
        await ensureAuthUser(emailRow, { name: nameRow ?? null });
        // 所属サービスの正準フラグ：app_metadata.apps に "business" を付与（LP側のルーティング判定用）。
        //   LP人材(candidate)は business ではないため付与しない（/business に誤振り分けしない）。
        if (finalRole !== "candidate") await markBusinessAuthApp(emailRow);
      }
    } catch { /* auth 連携失敗でも app_users 承認自体は成功扱い */ }

    await audit(id, null, "approve", `role=${upd.role}${company ? ` company=${company}` : ""}`, actor);
    bustMembers();
    return { ok: true };
  } catch (e: any) { return { ok: false, error: String(e?.message ?? e) }; }
}

/** LP登録エントリー（public.coo_talent_entries・任意LP）の承認取込。
 *   dxを唯一の承認ハブにするための入口。取込RPC lp_import_talent_entry（service_role専用）で
 *   enger.candidates に signup_source=source 付きで人材化する（＝即マッチング対象）。
 *   id は "entry:<uuid>"（listLpTalentEntries が付与）。 */
export async function approveTalentEntry(entryId: string): Promise<Result & { candidateId?: string; candidate_no?: number }> {
  const guard = await requireAdminOrAgent();
  if (!guard.ok) return guard;
  const actor = guard.actor!;
  const realId = entryId.startsWith("entry:") ? entryId.slice("entry:".length) : entryId;
  if (!realId) return { ok: false, error: "id がありません" };
  try {
    const pub = publicAdmin();
    const { data, error } = await pub.rpc("lp_import_talent_entry", { p_entry_id: realId, p_imported_by: actor.email });
    if (error) {
      const m = error.message || "";
      if (/already processed/i.test(m)) return { ok: false, error: "このエントリーは処理済みです。" };
      if (/could not find the function|schema cache|PGRST202|does not exist/i.test(m))
        return { ok: false, error: "取込RPCが未適用です（Supabaseで supabase/migrations/20260716120000_lp_import_talent_entry.sql を実行してください）" };
      return { ok: false, error: m };
    }
    const candidateId = (data as any)?.candidate_id as string | undefined;
    // 0725：スキルシート全文（entries.payload）を candidates.skill_sheet_data へ写像し、
    //   人材一覧・マッチング画面のビューアで閲覧できるようにする（取込RPCの版に依存しない保険）。
    //   併せて candidate_no を解決し、承認直後に「マッチングへ」導線を出せるようにする。
    let candidateNo: number | undefined;
    if (candidateId) {
      try {
        const admin = engerAdmin();
        const er: any = await pub.from("coo_talent_entries").select("payload").eq("id", realId).maybeSingle();
        if (er?.data?.payload) {
          await admin.from("candidates").update({ skill_sheet_data: er.data.payload }).eq("id", candidateId);
        }
        const cr: any = await admin.from("candidates").select("candidate_no").eq("id", candidateId).maybeSingle();
        candidateNo = cr?.data?.candidate_no ?? undefined;
      } catch { /* 列未整備・取得失敗でも取込自体は成功扱い */ }
    }
    await audit(realId, null, "talent_entry_import", candidateId ? `candidate=${candidateId}` : null, actor);
    revalidateTag("sidebar-counts", "max");
    revalidatePath("/newcomers"); revalidatePath("/people"); revalidatePath("/companies");
    return { ok: true, candidateId, candidate_no: candidateNo };
  } catch (e: any) { return { ok: false, error: String(e?.message ?? e) }; }
}

/** LP登録エントリーを却下（status='rejected'）。service_role で直接更新（RPC不要）。 */
export async function rejectTalentEntry(entryId: string): Promise<Result> {
  const guard = await requireAdminOrAgent();
  if (!guard.ok) return guard;
  const actor = guard.actor!;
  const realId = entryId.startsWith("entry:") ? entryId.slice("entry:".length) : entryId;
  if (!realId) return { ok: false, error: "id がありません" };
  try {
    const pub = publicAdmin();
    const { error } = await pub.from("coo_talent_entries").update({ status: "rejected" }).eq("id", realId).eq("status", "new");
    if (error) return { ok: false, error: error.message };
    await audit(realId, null, "talent_entry_reject", null, actor);
    revalidateTag("sidebar-counts", "max");
    revalidatePath("/newcomers");
    return { ok: true };
  } catch (e: any) { return { ok: false, error: String(e?.message ?? e) }; }
}

/**
 * 新着一覧の「面談」チェック＝新規登録者を1アクションで本登録＋全機能解放する。
 *   ① 承認（app_users を active／LP登録エントリーは取込RPC）
 *   ② フリーランス（profile/auth 由来）は enger.candidates へ登録＝マッチング対象化
 *   ③ 面談済（engineer_actions "面談済"）を付与＝人材ダッシュボードの全機能を解放
 * 既存のテスト済みアクション（approveAccount / approveTalentEntry /
 * prepareCandidateFromFreelancer / registerCandidateFromFreelancer /
 * setEngineerMeetingDone）を組み合わせるだけで、新しい判定ロジックは足さない。
 */
export async function approveNewcomerAsMeeting(input: {
  id: string; email: string; name?: string | null; role: string; company_name?: string | null;
}): Promise<Result & { candidate_no?: number }> {
  const { id, email } = input;
  const name = input.name ?? null;
  // LP登録エントリー（COO 等）は取込RPCで candidates 化（＝マッチング対象）。面談済の概念は取込側で扱う。
  if (id.startsWith("entry:")) {
    return await approveTalentEntry(id);
  }

  // 1) 承認（app_users を active / role 確定）。LP仮想行は email/name を添える。
  const fd = new FormData();
  fd.set("id", id);
  fd.set("role", input.role || "candidate");
  if (input.company_name) fd.set("company_name", input.company_name);
  if (id.startsWith("profile:") || id.startsWith("auth:")) {
    fd.set("email", email); if (name) fd.set("name", name);
  }
  const appr = await approveAccount(fd);
  if (!appr.ok) return appr;

  // profile:/auth: 以外（実 app_users id）はフリーランス登録の対象外。承認のみで完了。
  const engineerId = id.startsWith("profile:") ? id.slice("profile:".length)
    : id.startsWith("auth:") ? id.slice("auth:".length) : "";
  if (!engineerId) return { ok: true };

  // 2) フリーランス → enger.candidates へ登録（マッチング対象化）。best-effort。
  //    0725：登録された P 番号を返し、新着タブから「マッチングへ」直行できるようにする。
  let candidateNo: number | undefined;
  try {
    const prep = await prepareCandidateFromFreelancer(engineerId);
    if (prep.ok && prep.data?.already_no) candidateNo = prep.data.already_no;
    if (prep.ok && prep.data && !prep.data.already_no) {
      const reg = await registerCandidateFromFreelancer({
        engineer_id: engineerId,
        name: prep.data.name || name || (email.split("@")[0] ?? "候補者"),
        title: prep.data.title || null,
        affiliation: prep.data.affiliation || null,
        skills: prep.data.skills, tools: prep.data.tools,
        rate: prep.data.rate || null, rate_num: prep.data.rate_num,
        location: prep.data.location || null, residence: prep.data.residence || null,
        remote_pref: prep.data.remote_pref || null, age_band: prep.data.age_band || null,
        nationality: prep.data.nationality || null, email: prep.data.email || email,
        industries: prep.data.industries || null, pr_text: prep.data.pr_text || null,
        skill_sheets: prep.data.skill_sheets,
      });
      if (reg.ok && reg.candidate_no) candidateNo = reg.candidate_no;
    }
  } catch (e) { console.error("[approveNewcomerAsMeeting] candidate register failed", e); }

  // 3) 面談済（全機能解放）。
  try { await setEngineerMeetingDone({ engineer_id: engineerId, engineer_name: name, done: true }); }
  catch (e) { console.error("[approveNewcomerAsMeeting] meeting-done failed", e); }

  revalidatePath("/matching"); revalidatePath("/people"); revalidateTag("sidebar-counts", "max");
  return { ok: true, candidate_no: candidateNo };
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

/** 所属部署を管理者が設定。 */
export async function setAccountDepartment(id: string, department: string | null): Promise<Result> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard;
  if (!id) return { ok: false, error: "id がありません" };
  try {
    const sb = engerAdmin();
    const { error } = await sb.from("app_users").update({ department: department || null }).eq("id", id);
    if (error) return { ok: false, error: error.message };
    bustMembers(); revalidatePath("/"); revalidatePath("/reports");
    return { ok: true };
  } catch (e: any) { return { ok: false, error: String(e?.message ?? e) }; }
}

/** 権限3段階（メンバー / マネージャー / 管理）を管理者が設定。
 *   管理      … role=admin
 *   マネージャー … role=agent ＋ team_role=manager
 *   メンバー   … role=agent ＋ team_role=member
 *  ユーザー管理の再設計で、旧「区分＋部署＋役職＋職能」の組み合わせをこの1操作に集約した。 */
export async function setAccountPermission(id: string, level: "admin" | "manager" | "member"): Promise<Result> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard;
  const actor = guard.actor!;
  if (!id) return { ok: false, error: "id がありません" };
  if (!["admin", "manager", "member"].includes(level)) return { ok: false, error: "不正な権限です" };
  try {
    const sb = engerAdmin();
    const patch: Record<string, any> = level === "admin" ? { role: "admin" } : { role: "agent", team_role: level };
    const { error } = await sb.from("app_users").update(patch).eq("id", id);
    if (error) return { ok: false, error: error.message };
    await audit(id, null, "permission_change", `level=${level}`, actor);
    bustMembers(); revalidatePath("/"); revalidatePath("/reports");
    return { ok: true };
  } catch (e: any) { return { ok: false, error: String(e?.message ?? e) }; }
}

/** チーム役職（manager/leader/member）を管理者が設定。 */
export async function setAccountTeamRole(id: string, teamRole: "manager" | "leader" | "member" | null): Promise<Result> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard;
  if (!id) return { ok: false, error: "id がありません" };
  if (teamRole && !["manager", "leader", "member"].includes(teamRole)) return { ok: false, error: "不正な役職です" };
  try {
    const sb = engerAdmin();
    const { error } = await sb.from("app_users").update({ team_role: teamRole || null }).eq("id", id);
    if (error) return { ok: false, error: error.message };
    bustMembers(); revalidatePath("/"); revalidatePath("/reports");
    return { ok: true };
  } catch (e: any) { return { ok: false, error: String(e?.message ?? e) }; }
}

/** タイムカード対象（バイト/副業の本人打刻）を管理者が ON/OFF。 */
export async function setAccountTimecard(id: string, enabled: boolean): Promise<Result> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard;
  if (!id) return { ok: false, error: "id がありません" };
  try {
    const sb = engerAdmin();
    const { error } = await sb.from("app_users").update({ is_timecard_user: enabled }).eq("id", id);
    // is_timecard_user 列が未作成（マイグレ前）の場合はわかりやすいメッセージに。
    if (error) return { ok: false, error: /is_timecard_user|column/i.test(error.message) ? "timecard 列が未作成です。supabase/timecard.sql を実行してください。" : error.message };
    bustMembers(); revalidatePath("/"); revalidatePath("/timecard");
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
export async function resetAccountPassword(email: string): Promise<Result & { password?: string; created?: boolean }> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard;
  const e = (email || "").trim().toLowerCase();
  if (!e) return { ok: false, error: "メールがありません" };
  try {
    // app_users の氏名・ロールを取得（auth.users 新規作成の user_metadata／business フラグ判定に使う）
    let displayName: string | null = null;
    let accRole: string | null = null;
    try {
      const sb = engerAdmin();
      const { data: u } = await sb.from("app_users").select("name, role").ilike("email", e).maybeSingle();
      displayName = ((u as any)?.name ?? null) as string | null;
      accRole = ((u as any)?.role ?? null) as string | null;
    } catch { /* ignore */ }

    const password = genTempPassword();
    // 既存があれば updateUserById、無ければ ensureAuthUser で新規作成（password を直接指定）
    let uid = await findAuthUserIdByEmail(e);
    let created = false;
    if (!uid) {
      const ens = await ensureAuthUser(e, { password, name: displayName });
      if (!ens.id) return { ok: false, error: ens.error ?? "認証ユーザーの作成に失敗しました" };
      uid = ens.id;
      created = ens.created;
    } else {
      const { error } = await authAdmin().auth.admin.updateUserById(uid, { password });
      if (error) return { ok: false, error: error.message };
    }
    if (accRole !== "candidate") await markBusinessAuthApp(e); // 所属サービスの正準フラグ（LP人材は除外）
    return { ok: true, password, created };
  } catch (err: any) {
    return { ok: false, error: String(err?.message ?? err) };
  }
}

/** 既に app_users に居て auth.users が無い「ログイン不可」のアカウントを一括で作成する。
 *  対象は status=active かつ auth.users 未登録のもの。各メールに仮パスワードを発行して返却。 */
export async function backfillAuthForActiveAccounts(): Promise<{ ok: boolean; results?: { email: string; password?: string; created: boolean; error?: string }[]; error?: string }> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard;
  try {
    const sb = engerAdmin();
    const { data, error } = await sb.from("app_users").select("email, name, status, role").eq("status", "active");
    if (error) return { ok: false, error: error.message };
    const list = (data ?? []) as { email: string | null; name: string | null; status: string; role: string | null }[];
    const results: { email: string; password?: string; created: boolean; error?: string }[] = [];
    for (const u of list) {
      const e = (u.email ?? "").trim().toLowerCase();
      if (!e) continue;
      const biz = u.role !== "candidate"; // LP人材(candidate)は business フラグ対象外
      const existing = await findAuthUserIdByEmail(e);
      if (existing) { if (biz) await markBusinessAuthApp(e); continue; } // 既存はフラグのみ付与（パスワードは触らない）
      const password = genTempPassword();
      const ens = await ensureAuthUser(e, { password, name: u.name });
      if (ens.error) results.push({ email: e, created: false, error: ens.error });
      else { if (biz) await markBusinessAuthApp(e); results.push({ email: e, password, created: ens.created }); }
    }
    bustMembers();
    return { ok: true, results };
  } catch (err: any) { return { ok: false, error: String(err?.message ?? err) }; }
}

/** 既存の全ビジネスアカウント（app_users の role≠candidate）の認証ユーザーに
 *  app_metadata.apps=["business"] を一括付与する（LP側の「apps に business が無い→フリーランス画面」
 *  という厳密ルーティングに備えたバックフィル）。
 *   ・ロール candidate（LP人材）は business ではないため対象外。
 *   ・auth.users が未作成のアカウントは付与できない（noAuth に計上。「ログイン不可を一括修復」で先に作成が必要）。
 *   ・冪等：既に business が付いていれば marked に数えつつ再付与しない。 */
export async function backfillBusinessAppMetadata(): Promise<{ ok: boolean; total?: number; marked?: number; noAuth?: number; failed?: number; failedEmails?: string[]; error?: string }> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard;
  try {
    const sb = engerAdmin();
    const { data, error } = await sb.from("app_users").select("email, role").neq("role", "candidate");
    if (error) return { ok: false, error: error.message };
    const emails = Array.from(new Set(((data ?? []) as { email: string | null }[])
      .map((u) => (u.email ?? "").trim().toLowerCase()).filter(Boolean)));
    let marked = 0, noAuth = 0, failed = 0;
    const failedEmails: string[] = [];
    for (const e of emails) {
      const ok = await markBusinessAuthApp(e);
      if (ok) { marked++; continue; }
      // 付与できなかった＝auth ユーザーが居ない（noAuth）か API エラー（failed）。区別のため再確認。
      const uid = await findAuthUserIdByEmail(e);
      if (!uid) noAuth++; else { failed++; failedEmails.push(e); }
    }
    return { ok: true, total: emails.length, marked, noAuth, failed, failedEmails: failedEmails.slice(0, 20) };
  } catch (err: any) { return { ok: false, error: String(err?.message ?? err) }; }
}

/** アカウント削除。 */
export async function deleteAccount(id: string): Promise<Result> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard;
  if (!id) return { ok: false, error: "id がありません" };
  const r = await bulkDeleteAccounts([id]);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true };
}

// 単一行の安全な削除（id の種類で削除先を出し分け）。bulk から呼ばれる内部実装。
//   ・"profile:<uuid>" → public.profiles 削除（メールが分かれば auth.users も削除）
//   ・"auth:<uuid>"    → auth.users 削除のみ（profiles なし）
//   ・"<uuid>"         → enger.app_users 削除＋同メールの auth.users 削除（あれば）
async function deleteOneAccountInternal(
  id: string, email: string | null, actor: Actor,
): Promise<Result> {
  try {
    const sb = engerAdmin();
    if (id.startsWith("profile:")) {
      const pid = id.slice("profile:".length);
      // profiles は public スキーマ。engerAdmin (enger スキーマ) から触ると見つからないため publicAdmin を使う。
      //   以前 engerAdmin().from("profiles") を呼んで silently スキーマ未存在エラー → catchで握り潰し、
      //   UI は「成功」を返すのに実体は残る、という挙動（LP登録者が一括削除で消えない症状の根因）があった。
      const pub = publicAdmin();
      // メール確定 → profile削除
      let em = (email ?? "").toLowerCase().trim() || null;
      if (!em) {
        try {
          const pr: any = await pub.from("profiles").select("email").eq("id", pid).maybeSingle();
          em = (pr.data?.email ?? null)?.toLowerCase().trim() || null;
        } catch { /* メール取得失敗は致命ではない */ }
      }
      // profile 本体を削除。失敗したら全体を失敗扱いにして UI に伝える（旧:catchで握り潰し）。
      const { error: pErr } = await pub.from("profiles").delete().eq("id", pid);
      if (pErr) return { ok: false, error: `LP profile 削除に失敗: ${pErr.message}` };
      if (em) {
        try {
          const authId = await findAuthUserIdByEmail(em);
          if (authId) await authAdmin().auth.admin.deleteUser(authId);
        } catch { /* auth 同期失敗は致命ではない */ }
      }
      await audit(id, em, "delete_lp_profile", null, actor);
      return { ok: true };
    }
    if (id.startsWith("auth:")) {
      const aid = id.slice("auth:".length);
      try { await authAdmin().auth.admin.deleteUser(aid); } catch { /* ignore */ }
      await audit(id, email, "delete_lp_auth", null, actor);
      return { ok: true };
    }
    // 通常の app_users 行：先に対象メールを取得（auth.users 連動削除のため）
    let em = (email ?? "").toLowerCase().trim() || null;
    if (!em) {
      try {
        const u: any = await sb.from("app_users").select("email").eq("id", id).maybeSingle();
        em = (u.data?.email ?? null)?.toLowerCase().trim() || null;
      } catch { /* ignore */ }
    }
    const { error } = await sb.from("app_users").delete().eq("id", id);
    if (error) return { ok: false, error: error.message };
    if (em) {
      try {
        const authId = await findAuthUserIdByEmail(em);
        if (authId) await authAdmin().auth.admin.deleteUser(authId);
      } catch { /* auth 同期失敗は致命ではない */ }
    }
    await audit(id, em, "delete", null, actor);
    return { ok: true };
  } catch (e: any) { return { ok: false, error: String(e?.message ?? e) }; }
}

/** 複数アカウント削除（admin のみ）。LP仮想エントリ(profile:/auth:)・通常 app_users を混在で受け取れる。
 *  自分自身は誤って削除できない（actor.email と一致するメールはスキップ）。 */
export async function bulkDeleteAccounts(
  items: Array<string | { id: string; email?: string | null }>,
): Promise<{ ok: true; deleted: number; skipped: number; errors: { id: string; error: string }[] } | { ok: false; error: string }> {
  const guard = await requireAdmin();
  if (!guard.ok) return { ok: false, error: guard.error ?? "管理者権限が必要です" };
  const actor = guard.actor!;
  if (!items?.length) return { ok: false, error: "削除対象が指定されていません" };

  const norm = items.map((it) => typeof it === "string" ? { id: it, email: null } : { id: it.id, email: it.email ?? null });
  let deleted = 0, skipped = 0;
  const errors: { id: string; error: string }[] = [];

  for (const it of norm) {
    if (!it.id) { skipped++; continue; }
    // 自分自身（メール一致）は安全のため拒否
    if (it.email && actor.email && it.email.toLowerCase().trim() === actor.email.toLowerCase().trim()) {
      errors.push({ id: it.id, error: "自分自身のアカウントは削除できません" });
      continue;
    }
    const r = await deleteOneAccountInternal(it.id, it.email ?? null, actor);
    if (r.ok) deleted++; else errors.push({ id: it.id, error: r.error ?? "削除に失敗しました" });
  }

  bustMembers();
  revalidatePath("/settings");
  return { ok: true, deleted, skipped, errors };
}
