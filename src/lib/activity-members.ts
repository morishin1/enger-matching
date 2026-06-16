// ダッシュボード／KPI推移の「メンバー別アクティビティ」に出すメンバー一覧の解決。
//   表示メンバーは proposal_owners（「メンバー編集」で管理する名簿）を“正”とする。
//   ＝名簿に登録された名前だけを表示し、外した人はアクティビティからも消える。
//   名簿が未設定のときだけ staff / app_users（admin=全員 / マネージャー=自部署）にフォールバック。
//   email は app_users → staff の順で名前から名寄せ補完（kpi_targets.owner_email と一致させる）。

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

  // proposal_owners（「メンバー編集」で管理する名簿）を“正”とする。
  //   ＝ここに登録された名前だけを表示する。メンバーから外した人（例：工藤）は表示からも消える。
  //   未設定のときだけ staff / app_users へフォールバックする。
  let ownerNames: string[] = [];
  try {
    const po = await loadProposalOwners();
    if (po) ownerNames = Array.from(new Set([...(po.proposers ?? []), ...(po.closers ?? [])].map((n) => String(n ?? "").trim()).filter(Boolean)));
  } catch { /* noop */ }

  const out: ActivityMember[] = [];
  const seen = new Set<string>();
  const push = (name: string, email: string | null) => {
    const key = name.trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({ name: key, email: resolveEmail(key, email) });
  };

  if (ownerNames.length > 0) {
    // 名簿を正としてそのまま表示（admin/マネージャー共通）。email は app_users/staff で名寄せ補完。
    for (const n of ownerNames) push(n, null);
  } else {
    // 名簿が未設定の環境のみ、従来どおり staff / app_users から組み立てる。
    const baseFromStaff = isAdmin ? staffRows : staffRows.filter((s) => s.department && s.department === access.department);
    const baseFromAuth  = isAdmin ? authRows  : authRows.filter((u) => u.department && u.department === access.department);
    for (const s of baseFromStaff) push(s.name, s.email);
    for (const u of baseFromAuth)  push(u.name, u.email);
  }
  return out;
}
