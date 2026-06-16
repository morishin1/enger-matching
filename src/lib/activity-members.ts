// ダッシュボード／KPI推移の「メンバー別アクティビティ」に出すメンバー一覧の解決。
//   ・admin            : staff(active 全員) ∪ proposal_owners(提案者/クロージング)
//   ・manager / leader : 自部署メンバー ∪ proposal_owners
//   proposal_owners は「設定 / 提案管理」で admin/マネージャーが編集できる名前リスト。
//   これを含めることで、メンバーの追加・削除を既存の編集UIから行える（数名固定にならない）。
//   email は次の優先順で解決：app_users → staff（名前で名寄せ）。
//     ※ app_users はログイン認証の真実情報（kpi_targets の owner_email と同じ値）。
//        staff にメールが未登録でも、ログインさえできていれば正しいメールが付く。

import { engerAdmin } from "./supabase";
import { canManageDept } from "./roles";
import { loadProposalOwners } from "./proposal-owners";
import { ownerMatches } from "./owner-match";

export type ActivityMember = { name: string; email: string | null };

export async function resolveActivityMembers(access: { role: string; teamRole?: string | null; department?: string | null }): Promise<ActivityMember[]> {
  const isAdmin = access.role === "admin";
  const isManager = canManageDept(access.teamRole ?? null);
  if (!isAdmin && !isManager) return [];

  const sb = (() => { try { return engerAdmin(); } catch { return null; } })();

  // ① staff: 部署フィルタやベース一覧のため使う。email は無くても OK。
  let staffRows: { name: string; email: string | null; department: string | null }[] = [];
  try {
    if (sb) {
      const r: any = await sb.from("staff").select("name, email, department").eq("active", true).not("name", "is", null).order("name");
      staffRows = (r.data ?? []).map((s: any) => ({ name: s.name, email: s.email ?? null, department: s.department ?? null }));
    }
  } catch { /* staff 未整備でも続行 */ }

  // ② app_users: 認証済みアカウントの正しい email を名前で名寄せして使う。
  //   ・社内ロール(admin/agent)のみ対象（クライアント等を混ぜない）。
  //   ・name→email のマップを作って後で補完に使う。
  const authEmailByName = new Map<string, string>(); // key: 名前(trim), value: email(lowercase)
  let authRows: { name: string; email: string; department: string | null }[] = [];
  try {
    if (sb) {
      let au: any = await sb.from("app_users").select("name, email, role, department").in("role", ["admin", "agent"]);
      if (au.error) au = await sb.from("app_users").select("name, email, role").in("role", ["admin", "agent"]);
      for (const u of (au.data ?? []) as any[]) {
        const nm = String(u?.name ?? "").trim();
        const em = String(u?.email ?? "").trim().toLowerCase();
        if (!nm || !em) continue;
        if (!authEmailByName.has(nm)) authEmailByName.set(nm, em);
        authRows.push({ name: nm, email: em, department: (u?.department ?? null) as string | null });
      }
    }
  } catch { /* app_users 未整備でも続行 */ }

  // 名前 → email の解決ヘルパ。app_users（厳密一致 → ゆるい一致）→ staff の順で探す。
  const resolveEmail = (name: string, fallback: string | null): string | null => {
    const key = name.trim();
    if (!key) return fallback;
    const exact = authEmailByName.get(key);
    if (exact) return exact;
    for (const [k, v] of authEmailByName) if (ownerMatches(k, key) || ownerMatches(key, k)) return v;
    return fallback;
  };

  // ベース：admin=全員 / マネージャー=自部署。
  //   staff にメンバーが居ない環境のため、app_users もベース候補として併用する。
  const baseFromStaff = isAdmin ? staffRows : staffRows.filter((s) => s.department && s.department === access.department);
  const baseFromAuth  = isAdmin ? authRows  : authRows.filter((u) => u.department && u.department === access.department);

  // proposal_owners の名前を追加（提案者∪クロージング）。
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
    seen.add(key);
    out.push({ name: key, email: resolveEmail(key, email) });
  };
  for (const s of baseFromStaff) push(s.name, s.email);
  for (const u of baseFromAuth)  push(u.name, u.email);
  for (const n of ownerNames) push(n, null);
  return out;
}
