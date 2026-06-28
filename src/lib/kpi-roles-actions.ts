"use server";

// KPI役割の割当・ファネル目標の保存（マネージャー以上）。
import { revalidatePath } from "next/cache";
import { engerAdmin } from "./supabase";
import { currentAccess, getAccountByEmail } from "./accounts";
import { canManageDept } from "./roles";
import type { KpiRoleKey } from "./kpi-roles";

const ROLE_KEYS: KpiRoleKey[] = ["outside", "inside", "telapo"];

/** メンバーの役割(outside/inside/telapo)を設定。admin / 同部署のマネージャー・リーダーのみ。 */
export async function setMemberKpiRole(email: string, role: KpiRoleKey | ""): Promise<{ ok: boolean; error?: string }> {
  const me = await currentAccess();
  if (!me) return { ok: false, error: "未認証です" };
  const target = String(email ?? "").toLowerCase().trim();
  if (!target) return { ok: false, error: "対象メンバーが未指定です" };
  if (role !== "" && !ROLE_KEYS.includes(role as KpiRoleKey)) return { ok: false, error: "不正な役割です" };

  // 権限：admin は全員。マネージャー/リーダーは自部署メンバーのみ。
  if (me.role !== "admin") {
    if (!canManageDept(me.teamRole)) return { ok: false, error: "役割の設定はマネージャー以上のみ可能です" };
    const acc = await getAccountByEmail(target);
    const sameDept = !!acc && (acc as any).department && me.department && (acc as any).department === me.department;
    if (!sameDept) return { ok: false, error: "自部署のメンバーのみ設定できます" };
  }

  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY 未設定" }; }
  const { error } = await admin.from("app_users").update({ kpi_role: role === "" ? null : role }).ilike("email", target);
  if (error) {
    if (/kpi_role|column/i.test(error.message)) return { ok: false, error: "supabase/kpi-roles-funnel.sql の適用が必要です（kpi_role 列が未追加）" };
    return { ok: false, error: error.message };
  }
  // 設定（ユーザー管理）・KPI推移（/proposals 埋め込み）・/kpi のいずれにも反映させる。
  revalidatePath("/kpi");
  revalidatePath("/proposals");
  revalidatePath("/settings");
  return { ok: true };
}

/** チームのファネル目標（稼働数・面談率・合格率）を保存。admin / マネージャー・リーダーのみ。 */
export async function saveKpiFunnelTarget(input: { won: number; meetingRate: number; passRate: number }): Promise<{ ok: boolean; error?: string }> {
  const me = await currentAccess();
  if (!me) return { ok: false, error: "未認証です" };
  if (me.role !== "admin" && !canManageDept(me.teamRole)) return { ok: false, error: "ファネル目標の設定はマネージャー以上のみ可能です" };

  const won = Math.max(0, Number(input.won) || 0);
  // 率は % でも 0〜1 でも受ける（>1 は % とみなす）。
  const norm = (v: number) => { const n = Number(v) || 0; return n > 1 ? n / 100 : n; };
  const meetingRate = Math.min(1, Math.max(0, norm(input.meetingRate)));
  const passRate = Math.min(1, Math.max(0, norm(input.passRate)));
  if (won <= 0) return { ok: false, error: "稼働目標は1以上で入力してください" };
  if (meetingRate <= 0 || passRate <= 0) return { ok: false, error: "面談率・合格率は0より大きい値で入力してください" };

  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY 未設定" }; }
  const by = me.name?.trim() || me.email || null;
  const { error } = await admin.from("kpi_funnel_target").upsert({
    id: 1, won_target: won, meeting_rate: meetingRate, pass_rate: passRate, updated_by: by, updated_at: new Date().toISOString(),
  }, { onConflict: "id" });
  if (error) {
    if (/kpi_funnel_target|relation|column/i.test(error.message)) return { ok: false, error: "supabase/kpi-roles-funnel.sql の適用が必要です（kpi_funnel_target が未作成）" };
    return { ok: false, error: error.message };
  }
  revalidatePath("/kpi");
  return { ok: true };
}
