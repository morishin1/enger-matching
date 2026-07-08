"use server";

// 個人月次KGI 保存用 Server Action（複数KPI対応）。権限チェック内蔵。
//   - admin: 全員を編集可能
//   - manager/leader: 自部署メンバーのみ編集可能
//   - それ以外: 不可
//   targets（{metricKey: number}）を保存し、placement は placement_target にミラーする。

import { revalidatePath } from "next/cache";
import { engerAdmin } from "./supabase";
import { currentAccess, getAccountByEmail } from "./accounts";
import { canManageDept } from "./roles";
import { PLACEMENT_KEY } from "./kpi-metrics";
import { isProposerMemberEmail } from "./proposal-owners";
import type { PersonKgiInput } from "./person-kgi";

type Result = { ok: boolean; error?: string };
type Access = NonNullable<Awaited<ReturnType<typeof currentAccess>>>;

/** targets を 0以上の数値のみに正規化（空/負/NaN は除外）。 */
function cleanTargets(targets?: Record<string, number | null> | null): Record<string, number> {
  const out: Record<string, number> = {};
  if (!targets) return out;
  for (const [k, v] of Object.entries(targets)) {
    const key = String(k ?? "").trim();
    if (!key) continue;
    if (v == null) continue;
    const n = Number(v);
    if (Number.isNaN(n) || n < 0) continue;
    out[key] = n;
  }
  return out;
}

/** 1件の個人KGIを永続化（権限は呼び出し側で確定済みの access を渡す）。revalidate はしない。 */
async function persistKgi(access: Access, input: PersonKgiInput): Promise<Result> {
  const targetEmail = (input.owner_email || "").toLowerCase().trim();
  if (!targetEmail) return { ok: false, error: "対象メンバーが未指定です" };
  if (!/^\d{4}-\d{2}-01$/.test(input.month)) return { ok: false, error: "月の指定が不正です（YYYY-MM-01）" };

  const targets = cleanTargets(input.targets);
  // placement は targets.placement を優先し、互換用の placement_target にミラー。
  const placement = targets[PLACEMENT_KEY] != null
    ? targets[PLACEMENT_KEY]
    : (input.placement_target != null && !Number.isNaN(Number(input.placement_target)) && Number(input.placement_target) >= 0 ? Number(input.placement_target) : null);
  if (placement != null) targets[PLACEMENT_KEY] = placement;

  // #338：名前のみメンバー（提案者＝合成キー "name:…"）はアカウントマスタ照合をスキップし、
  //   氏名だけで個人KGIを保存できるようにする（管理者、または対象部署のマネージャー/リーダー）。
  let targetName: string | null;
  let targetDept: string | null;
  if (isProposerMemberEmail(targetEmail)) {
    const isAdmin = access.role === "admin";
    const canMgr = canManageDept(access.teamRole) && !!access.department;
    if (!isAdmin && !canMgr) {
      return { ok: false, error: "権限がありません（管理者または部署のマネージャー/リーダーのみ編集可）" };
    }
    targetName = input.owner_name ?? targetEmail.replace(/^name:/i, "");
    targetDept = input.department ?? access.department ?? null;
  } else {
    // 対象メンバーの部署を取得
    const target = await getAccountByEmail(targetEmail);
    if (!target) return { ok: false, error: `${targetEmail} はアカウントマスタに存在しません` };
    const isAdmin = access.role === "admin";
    const canMgr = canManageDept(access.teamRole) && !!access.department && (target as any).department === access.department;
    if (!isAdmin && !canMgr) {
      return { ok: false, error: "権限がありません（管理者または対象メンバーが所属する部署のマネージャー/リーダーのみ編集可）" };
    }
    targetName = target.name ?? input.owner_name ?? null;
    targetDept = (target as any).department ?? input.department ?? null;
  }

  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }

  const row = {
    owner_email: targetEmail,
    owner_name: targetName,
    department: targetDept,
    month: input.month,
    placement_target: placement,
    targets,
    note: input.note ?? null,
    updated_by_email: access.email || null,
    updated_by_name: access.name || null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await admin.from("person_kgi").upsert(row, { onConflict: "owner_email,month" });
  if (error) {
    if (/targets|column/i.test(error.message)) {
      return { ok: false, error: "person_kgi.targets 列が未整備です（supabase/person-kgi-targets.sql を実行してください）" };
    }
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

function revalidateKgi() {
  revalidatePath("/settings/person-kgi");
  revalidatePath("/reports");
  revalidatePath("/");
}

/** 個人KGIを1件保存。 */
export async function savePersonKgi(input: PersonKgiInput): Promise<Result> {
  const access = await currentAccess();
  if (!access) return { ok: false, error: "ログインが必要です" };
  const r = await persistKgi(access, input);
  if (r.ok) revalidateKgi();
  return r;
}

/** 個人KGIを一括保存（チーム目標の配分後など）。1件でも失敗したら最初のエラーを返す。 */
export async function savePersonKgiBulk(inputs: PersonKgiInput[]): Promise<Result> {
  const access = await currentAccess();
  if (!access) return { ok: false, error: "ログインが必要です" };
  if (!Array.isArray(inputs) || inputs.length === 0) return { ok: true };
  let firstErr: string | null = null;
  let saved = 0;
  for (const input of inputs) {
    const r = await persistKgi(access, input);
    if (r.ok) saved++;
    else if (!firstErr) firstErr = r.error ?? "保存に失敗しました";
  }
  if (saved > 0) revalidateKgi();
  if (firstErr) return { ok: false, error: firstErr };
  return { ok: true };
}
