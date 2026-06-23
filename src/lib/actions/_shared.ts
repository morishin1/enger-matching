// actions.ts から切り出した共有ヘルパ（サーバー専用の内部ユーティリティ）。
//   "use server" は付けない＝Server Action ではなく、各ドメインの Server Action から
//   内部的に呼ばれる素のサーバー関数。これにより同期関数や引数に admin クライアントを
//   取るヘルパも自由に置ける（"use server" ファイルは全エクスポートが async 関数である
//   必要があるため、これらは置けない）。

import { revalidatePath, revalidateTag } from "next/cache";
import { engerAdmin } from "../supabase";

/** サイドバーのカウントキャッシュを即時更新する。(Next16: 第2引数 cacheLife が必須) */
export const bustCounts = () => revalidateTag("sidebar-counts", "max");

/** お知らせ(notifications)を1件登録（fail-soft）。recipient は氏名。失敗しても本処理は止めない。 */
export async function notify(recipient: string | null | undefined, title: string, body: string, kind = "info") {
  const r = (recipient ?? "").trim();
  if (!r) return;
  try {
    const admin = engerAdmin();
    await admin.from("notifications").insert({ recipient: r, title, body, kind });
    revalidatePath("/notifications");
  } catch { /* 通知失敗は本処理を止めない */ }
}

/** お知らせを複数宛先へ一括登録（fail-soft）。N件の逐次 INSERT を1回のバッチ INSERT に圧縮する。
 *   重複・空文字の宛先は除外。失敗しても本処理は止めない。 */
export async function notifyMany(recipients: Iterable<string | null | undefined>, title: string, body: string, kind = "info") {
  const names = Array.from(new Set(Array.from(recipients, (r) => (r ?? "").trim()).filter(Boolean)));
  if (names.length === 0) return;
  try {
    const admin = engerAdmin();
    await admin.from("notifications").insert(names.map((recipient) => ({ recipient, title, body, kind })));
    revalidatePath("/notifications");
  } catch { /* 通知失敗は本処理を止めない */ }
}

/** 提案作成用に案件を取得する。outside_owner 列が無い旧環境でも落ちないようフォールバックする。 */
export async function fetchJobForProposal(admin: ReturnType<typeof engerAdmin>, jobNo: number): Promise<any> {
  let jr = await admin.from("jobs").select("id, title, client_name, outside_owner").eq("job_no", jobNo).maybeSingle();
  if (jr.error) jr = await admin.from("jobs").select("id, title, client_name").eq("job_no", jobNo).maybeSingle();
  return jr.data;
}

/** 提案作成用に人材を取得する。打合せ済ゲート判定に使う source_company / company も取得し、
 *   これらの列が無い旧環境ではフォールバックする。 */
export async function fetchCandidateForProposal(admin: ReturnType<typeof engerAdmin>, candNo: number): Promise<any> {
  let cr = await admin.from("candidates").select("id, name, initials, rate, source_company, company").eq("candidate_no", candNo).maybeSingle();
  if (cr.error) cr = await admin.from("candidates").select("id, name, initials, rate").eq("candidate_no", candNo).maybeSingle();
  return cr.data;
}

/** 承認権限を持つ社内メンバー（admin / 経営部署 / マネージャー / リーダー）の氏名一覧。
 *   承認依頼は「指定された承認者1名だけ」では取りこぼし（氏名不一致・指名漏れ）が起きるため、
 *   承認できる全員に通知するためのリストを返す。app_users の列が未整備でも fail-soft。 */
export async function listApproverNames(): Promise<string[]> {
  try {
    const admin = engerAdmin();
    let res: any = await admin.from("app_users").select("name, role, department, team_role").not("name", "is", null);
    if (res.error) res = await admin.from("app_users").select("name, role").not("name", "is", null);
    if (res.error || !res.data) return [];
    const names = new Set<string>();
    for (const u of res.data as any[]) {
      const name = String(u.name ?? "").trim();
      if (!name) continue;
      const dept = String(u.department ?? "").trim();
      const tr = String(u.team_role ?? "").trim();
      const privileged = u.role === "admin" || dept === "経営" || tr === "manager" || tr === "leader";
      if (privileged) names.add(name);
    }
    return Array.from(names);
  } catch { return []; }
}

/** 提案ゲート用：与えられた企業名のうち、最初に「打合せ未済」のものを返す。
 *   判定：① meetings に company_name の記録あり、または ② companies.meeting_done = true で「済」。
 *   どちらの表でも判定できなかった場合は誤ブロック防止のため通過させる。
 *   空文字の name はスキップ。 */
export async function isCompanyMeetingMet(admin: ReturnType<typeof engerAdmin>, name: string): Promise<boolean> {
  const n = (name ?? "").trim();
  if (!n) return true; // 名前が無ければ判定対象外＝通過
  try {
    const { data } = await admin.from("meetings").select("id").ilike("company_name", n).limit(1);
    if ((data?.length ?? 0) > 0) return true;
  } catch { return true; /* meetings 未整備は誤ブロック防止で通過 */ }
  try {
    const { data } = await admin.from("companies").select("id").ilike("name", n).eq("meeting_done", true).limit(1);
    if ((data?.length ?? 0) > 0) return true;
  } catch { return true; /* companies 列未整備は通過 */ }
  return false;
}

/** 提案ゲート（緩和版・案②）：与えた企業名（案件 client_name と人材の所属企業）のうち、
 *  「少なくとも一方が打合せ済」であれば true を返して提案を許可。両方とも未済の場合のみ false。
 *  名前が空のものは判定対象から外す。これにより：
 *    ・打合せ済の案件 × 未済の人材所属企業 → 許可（アウトサイドへトスアップ可）
 *    ・打合せ済の人材所属企業 × 未済の案件 → 許可（人材側起点で営業可）
 *    ・両方未済                                → 拒否（無闇な提案で信用を損なわない） */
export async function gateAllowsProposal(
  admin: ReturnType<typeof engerAdmin>,
  targets: { label: string; name: string }[],
): Promise<{ allowed: true } | { allowed: false; unmet: { label: string; name: string }[] }> {
  const named = targets.filter((t) => (t.name ?? "").trim());
  if (named.length === 0) return { allowed: true }; // 双方名前なし＝判定不能・通過
  const unmet: { label: string; name: string }[] = [];
  let metAny = false;
  for (const t of named) {
    const met = await isCompanyMeetingMet(admin, t.name);
    if (met) metAny = true;
    else unmet.push(t);
  }
  if (metAny) return { allowed: true };
  return { allowed: false, unmet };
}

/** 氏名からイニシャル（先頭2語の頭文字）を作る。 */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "");
}

/** 重複判定用の正規化（空白・全角・記号を除去）。 */
export const normKey = (s?: string | null): string => String(s ?? "").toLowerCase().replace(/[\s　]/g, "").replace(/[（）()・,，、。．.\-－_/／]/g, "");
