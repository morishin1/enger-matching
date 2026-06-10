// ダッシュボード／KPI推移の「メンバー別アクティビティ」に出すメンバー一覧の解決。
//   ・admin            : staff(active 全員) ∪ proposal_owners(提案者/クロージング)
//   ・manager / leader : 自部署メンバー ∪ proposal_owners
//   proposal_owners は「設定 / 提案管理」で admin/マネージャーが編集できる名前リスト。
//   これを含めることで、メンバーの追加・削除を既存の編集UIから行える（数名固定にならない）。
//   email は staff から名前で引いて補完（個人KGI目標の突合に使う）。

import { engerAdmin } from "./supabase";
import { canManageDept } from "./roles";
import { loadProposalOwners } from "./proposal-owners";
import { ownerMatches } from "./owner-match";

export type ActivityMember = { name: string; email: string | null };

export async function resolveActivityMembers(access: { role: string; teamRole?: string | null; department?: string | null }): Promise<ActivityMember[]> {
  const isAdmin = access.role === "admin";
  const isManager = canManageDept(access.teamRole ?? null);
  if (!isAdmin && !isManager) return [];

  let staffRows: { name: string; email: string | null; department: string | null }[] = [];
  try {
    const sb = engerAdmin();
    const r: any = await sb.from("staff").select("name, email, department").eq("active", true).not("name", "is", null).order("name");
    staffRows = (r.data ?? []).map((s: any) => ({ name: s.name, email: s.email ?? null, department: s.department ?? null }));
  } catch { /* staff 未整備でも続行 */ }

  // ベース：admin=全員 / マネージャー=自部署
  const base = isAdmin ? staffRows : staffRows.filter((s) => s.department && s.department === access.department);

  // proposal_owners の名前を追加（提案者∪クロージング）。email は staff から名前一致で補完。
  let ownerNames: string[] = [];
  try {
    const po = await loadProposalOwners();
    if (po) ownerNames = Array.from(new Set([...(po.proposers ?? []), ...(po.closers ?? [])]));
  } catch { /* noop */ }

  const out: ActivityMember[] = [];
  const seen = new Set<string>();
  const push = (name: string, email: string | null) => {
    const key = name.trim();
    if (!key || seen.has(key)) return;
    seen.add(key); out.push({ name: key, email });
  };
  for (const s of base) push(s.name, s.email);
  for (const n of ownerNames) {
    const match = staffRows.find((s) => ownerMatches(s.name, n));
    push(n, match?.email ?? null);
  }
  return out;
}
