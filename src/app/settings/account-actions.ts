"use server";

import { revalidatePath } from "next/cache";
import { engerAdmin } from "@/lib/supabase";
import { authServerClient, authConfigured } from "@/lib/supabase-auth";
import { resolveAccess } from "@/lib/accounts";

type Result = { ok: boolean; error?: string };

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
      role: ["admin", "agent", "client"].includes(role) ? role : "client",
      company_name: company,
      approved_at: new Date().toISOString(),
    }).eq("id", id);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/settings");
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
    revalidatePath("/settings");
    return { ok: true };
  } catch (e: any) { return { ok: false, error: String(e?.message ?? e) }; }
}

/** ロール変更。 */
export async function setAccountRole(id: string, role: "admin" | "agent" | "client"): Promise<Result> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard;
  if (!id) return { ok: false, error: "id がありません" };
  try {
    const sb = engerAdmin();
    const { error } = await sb.from("app_users").update({ role }).eq("id", id);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/settings");
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
    revalidatePath("/settings");
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
    revalidatePath("/settings");
    revalidatePath("/");
    return { ok: true };
  } catch (e: any) { return { ok: false, error: String(e?.message ?? e) }; }
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
    revalidatePath("/settings");
    return { ok: true };
  } catch (e: any) { return { ok: false, error: String(e?.message ?? e) }; }
}
