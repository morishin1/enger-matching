// スキルシートの署名URL生成（管理NO #250）。
//   フリーランスがアップしたスキルシート（Supabase Storage bucket: skillsheets）について、
//   ログイン不要で「プレビュー閲覧」「ダウンロード」できる “期間限定の署名URL” を発行する。
//   ・公開バケットでも createSignedUrl は有効（推測困難なトークン付きURL＝共有しても期限切れで無効化できる）。
//   ・path（skill_sheets[].path）が無い場合は元の url をそのまま使う（後方互換）。
import { publicAdmin } from "./supabase";
import type { SkillSheet } from "./engineers";

const BUCKET = "skillsheets";
// 既定の有効期限（7日）。社外共有でも一定期間で失効する。
export const SKILL_SHEET_SIGNED_TTL_SEC = 60 * 60 * 24 * 7;

/** 1ファイルの署名URLを発行（path ベース）。失敗時は ok:false。 */
export async function signSkillSheetPath(
  path: string,
  expiresInSec: number = SKILL_SHEET_SIGNED_TTL_SEC,
): Promise<{ ok: true; url: string; expires_at: string } | { ok: false; error: string }> {
  if (!path) return { ok: false, error: "path がありません" };
  let admin: ReturnType<typeof publicAdmin>;
  try { admin = publicAdmin(); } catch { return { ok: false, error: "サーバ設定エラー（SUPABASE_SERVICE_ROLE_KEY 未設定）" }; }
  try {
    const r: any = await admin.storage.from(BUCKET).createSignedUrl(path, expiresInSec);
    const url = r?.data?.signedUrl;
    if (r?.error || !url) return { ok: false, error: r?.error?.message ?? "署名URLの発行に失敗しました" };
    return { ok: true, url, expires_at: new Date(Date.now() + expiresInSec * 1000).toISOString() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "署名URLの発行に失敗しました" };
  }
}

/** スキルシート配列（最大3件）を署名URLに付け替える。path が無い要素は元の url を維持。 */
export async function signSkillSheets(
  sheets: SkillSheet[] | null | undefined,
  expiresInSec: number = SKILL_SHEET_SIGNED_TTL_SEC,
): Promise<SkillSheet[]> {
  const list = (Array.isArray(sheets) ? sheets : []).filter((s) => s && (s.url || s.path)).slice(0, 3);
  const out: SkillSheet[] = [];
  for (const s of list) {
    if (!s.path) { out.push({ ...s, expires_at: null }); continue; }
    const signed = await signSkillSheetPath(s.path, expiresInSec);
    out.push({
      ...s,
      url: signed.ok ? signed.url : s.url,
      expires_at: signed.ok ? signed.expires_at : null,
    });
  }
  return out;
}
