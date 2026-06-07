"use server";

import { revalidatePath } from "next/cache";
import { engerAdmin } from "@/lib/supabase";
import { authServerClient, authConfigured } from "@/lib/supabase-auth";
import { resolveAccess } from "@/lib/accounts";
import { MENU_PERM_KEY, MENU_ITEMS, MENU_ROLE_KEYS, type MenuPermissions } from "@/lib/menu-permissions";
import { REPORT_SCOPE_KEY, REPORT_ROLE_KEYS, type ReportScope, type ReportScopes } from "@/lib/report-scope";

type Result = { ok: boolean; error?: string };

async function requireAdmin(): Promise<Result> {
  if (!authConfigured) return { ok: true };
  try {
    const sb = await authServerClient();
    const { data: { user } } = await sb.auth.getUser();
    const a = user?.email ? await resolveAccess(user.email) : null;
    return a?.role === "admin" && a.status === "active" ? { ok: true } : { ok: false, error: "管理者権限が必要です" };
  } catch (e: any) { return { ok: false, error: String(e?.message ?? e) }; }
}

/** メニュー表示権限を保存（管理者のみ）。受け取った値をサニタイズして app_settings に upsert。 */
export async function saveMenuPermissions(perms: MenuPermissions): Promise<Result> {
  const g = await requireAdmin(); if (!g.ok) return g;
  // ホワイトリストで正規化（未知のキーや href を弾く）
  const clean: MenuPermissions = { manager: {}, leader: {}, member: {}, none: {} };
  for (const rk of MENU_ROLE_KEYS) {
    for (const m of MENU_ITEMS) {
      clean[rk][m.href] = perms?.[rk]?.[m.href] !== false; // 既定 true
    }
  }
  try {
    const sb = engerAdmin();
    const { error } = await sb.from("app_settings").upsert({ key: MENU_PERM_KEY, value: clean }, { onConflict: "key" });
    if (error) {
      if (/app_settings|relation|column/i.test(error.message)) return { ok: false, error: "app_settings テーブルが未整備です（supabase/app-settings.sql を実行してください）" };
      return { ok: false, error: error.message };
    }
    // サイドバーは全ページで描画されるため広めに revalidate
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e: any) { return { ok: false, error: String(e?.message ?? e) }; }
}

/** 役職別の日報スコープを保存（管理者のみ）。 */
export async function saveReportScopes(scopes: ReportScopes): Promise<Result> {
  const g = await requireAdmin(); if (!g.ok) return g;
  // ホワイトリスト正規化
  const valid = (s: any): ReportScope => (s === "all" || s === "dept" || s === "self") ? s : "self";
  const clean: ReportScopes = { manager: valid(scopes?.manager), leader: valid(scopes?.leader), member: valid(scopes?.member), none: valid(scopes?.none) };
  // 念のためキーが揃っていることを確認
  for (const rk of REPORT_ROLE_KEYS) if (!(rk in clean)) clean[rk] = "self";
  try {
    const sb = engerAdmin();
    const { error } = await sb.from("app_settings").upsert({ key: REPORT_SCOPE_KEY, value: clean }, { onConflict: "key" });
    if (error) {
      if (/app_settings|relation|column/i.test(error.message)) return { ok: false, error: "app_settings テーブルが未整備です（supabase/app-settings.sql を実行してください）" };
      return { ok: false, error: error.message };
    }
    revalidatePath("/reports");
    return { ok: true };
  } catch (e: any) { return { ok: false, error: String(e?.message ?? e) }; }
}
