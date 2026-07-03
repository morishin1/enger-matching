// 所属サービスの正準フラグ（auth.users.app_metadata.apps）。
//   Supabase Auth（auth.users）は enger.jp（フリーランスLP）/ dx.enger.jp（ENGER business）/
//   無限道場などで共有されており、「この認証ユーザーはどのサービスの人か」を各サイトが
//   自前テーブルの有無から推測していたため、ログイン後の行き先の食い違いが起きていた。
//   → app_metadata.apps（例: ["business"], ["freelance"]）を正準の所属情報とする。
//     app_metadata はサーバー(service role)からのみ書ける改ざん不可領域。
//     dx 側はビジネスアカウントの作成/承認時に "business" を付与する（本ファイル）。
//     LP 側はログイン後 apps に "business" を含むユーザーを /business 側へルーティングし、
//     "freelance"（または profiles 行あり）ならフリーランス画面へ、が最終形。
import { authAdmin, publicAdmin } from "@/lib/supabase";

/** email から auth.users の id を解決（service role・最大5000件走査）。 */
async function findAuthUserIdByEmail(email: string): Promise<string | null> {
  const target = (email || "").toLowerCase().trim();
  if (!target) return null;
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

/** auth.users の app_metadata.apps に "business" を付与（冪等）。
 *  ビジネスアカウントの新規登録・承認・エージェント追加・一括修復から呼ぶ。
 *  auth ユーザー未作成や失敗時は false（呼び出し元の本処理は止めない）。 */
export async function markBusinessAuthApp(email: string): Promise<boolean> {
  try {
    const uid = await findAuthUserIdByEmail(email);
    if (!uid) return false;
    const aa = authAdmin();
    const g: any = await aa.auth.admin.getUserById(uid);
    const meta = (g?.data?.user?.app_metadata ?? {}) as Record<string, any>;
    const cur: string[] = Array.isArray(meta.apps) ? meta.apps.map(String) : [];
    if (cur.includes("business")) return true;
    const r: any = await aa.auth.admin.updateUserById(uid, { app_metadata: { ...meta, apps: [...cur, "business"] } } as any);
    return !r.error;
  } catch { return false; }
}

/** このメールが ENGERフリーランス（public.profiles）として登録済みか。
 *  ビジネスログイン拒否時のメッセージ出し分け（「フリーランスとして登録済みです」）に使う。 */
export async function hasFreelanceProfile(email: string): Promise<boolean> {
  const e = (email || "").trim();
  if (!e) return false;
  try {
    const pub = publicAdmin();
    const r: any = await pub.from("profiles").select("id").ilike("email", e).limit(1);
    return !r.error && (r.data ?? []).length > 0;
  } catch { return false; }
}
