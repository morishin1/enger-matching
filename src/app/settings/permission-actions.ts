"use server";

import { revalidatePath } from "next/cache";
import { engerAdmin } from "@/lib/supabase";
import { authServerClient, authConfigured } from "@/lib/supabase-auth";
import { resolveAccess } from "@/lib/accounts";
import { MENU_PERM_KEY, MENU_ITEMS, MENU_GROUP_KEYS, type MenuPermissions } from "@/lib/menu-permissions";
import { REPORT_SCOPE_KEY, REPORT_ROLE_KEYS, type ReportScope, type ReportScopes } from "@/lib/report-scope";
import { PROPOSAL_OWNERS_KEY, type ProposalOwners } from "@/lib/proposal-owners";
import { KPI_MEMBERS_KEY, normalizeKpiMembers, type KpiMember } from "@/lib/kpi-members";

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

// 管理者またはマネージャー/リーダー（チーム運営担当）を許可。
async function requireAdminOrManager(): Promise<Result> {
  if (!authConfigured) return { ok: true };
  try {
    const sb = await authServerClient();
    const { data: { user } } = await sb.auth.getUser();
    const a = user?.email ? await resolveAccess(user.email) : null;
    if (!a || a.status !== "active") return { ok: false, error: "ログインが必要です" };
    if (a.role === "admin") return { ok: true };
    if (a.teamRole === "manager" || a.teamRole === "leader") return { ok: true };
    return { ok: false, error: "管理者またはマネージャーの権限が必要です" };
  } catch (e: any) { return { ok: false, error: String(e?.message ?? e) }; }
}

/** メニュー表示権限を保存（管理者のみ）。受け取った値をサニタイズして app_settings に upsert。 */
export async function saveMenuPermissions(perms: MenuPermissions): Promise<Result> {
  const g = await requireAdmin(); if (!g.ok) return g;
  // ホワイトリストで正規化（未知のキーや href を弾く）
  const clean: MenuPermissions = { sales: {}, backoffice: {} };
  for (const gk of MENU_GROUP_KEYS) {
    for (const m of MENU_ITEMS) {
      clean[gk][m.href] = perms?.[gk]?.[m.href] !== false; // 既定 true
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

const trimUniq = (xs: any[]): string[] =>
  Array.from(new Set((xs ?? []).map((x) => String(x ?? "").trim()).filter(Boolean)));

/** 提案者・クロージング担当の名前リストを保存（管理者のみ）。 */
export async function saveProposalOwners(owners: ProposalOwners): Promise<Result> {
  const g = await requireAdminOrManager(); if (!g.ok) return g;
  const clean: ProposalOwners = {
    proposers: trimUniq(owners?.proposers ?? []).slice(0, 50),
    closers:   trimUniq(owners?.closers   ?? []).slice(0, 50),
  };
  try {
    const sb = engerAdmin();
    const { error } = await sb.from("app_settings").upsert({ key: PROPOSAL_OWNERS_KEY, value: clean }, { onConflict: "key" });
    if (error) {
      if (/app_settings|relation|column/i.test(error.message)) return { ok: false, error: "app_settings テーブルが未整備です（supabase/app-settings.sql を実行してください）" };
      return { ok: false, error: error.message };
    }
    revalidatePath("/proposals");
    revalidatePath("/matching");
    revalidatePath("/settings");
    return { ok: true };
  } catch (e: any) { return { ok: false, error: String(e?.message ?? e) }; }
}

/** KPI推移の担当者（メンバー）マスタを保存（管理者またはマネージャー/リーダー）。
 *  ここで保存した名前・チーム（アウトサイド/インサイド/テレアポ）が、KPI推移のメンバー行・役割と、
 *  打ち合わせ記録の自社担当プルダウンの選択肢に反映される。 */
export async function saveKpiMembers(members: KpiMember[]): Promise<Result> {
  const g = await requireAdminOrManager(); if (!g.ok) return g;
  const clean = normalizeKpiMembers(members);
  try {
    const sb = engerAdmin();
    const { error } = await sb.from("app_settings").upsert({ key: KPI_MEMBERS_KEY, value: clean }, { onConflict: "key" });
    if (error) {
      if (/app_settings|relation|column/i.test(error.message)) return { ok: false, error: "app_settings テーブルが未整備です（supabase/app-settings.sql を実行してください）" };
      return { ok: false, error: error.message };
    }
    revalidatePath("/proposals");
    revalidatePath("/meetings");
    return { ok: true };
  } catch (e: any) { return { ok: false, error: String(e?.message ?? e) }; }
}
