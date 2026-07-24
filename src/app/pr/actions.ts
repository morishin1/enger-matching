"use server";

import { revalidateTag } from "next/cache";
import { engerAdmin } from "@/lib/supabase";
import { currentAccess } from "@/lib/accounts";

/** /pr で「Xに投稿」したことを記録。ダッシュボードのPRアラート・担当別PR実施状況・「履歴」タブに使用。best-effort。
 *  text/url は投稿本文・リンク（履歴一覧で表示）。text/url 列が無い環境では operator/kind のみで記録（フォールバック）。 */
export async function logPrPost(kind: string, opts?: { text?: string; url?: string }): Promise<{ ok: boolean }> {
  try {
    const access = await currentAccess();
    const operator = access?.name || access?.email || null;
    const admin = engerAdmin();
    const text = (opts?.text ?? "").trim().slice(0, 1000) || null;
    const url = (opts?.url ?? "").trim().slice(0, 500) || null;
    const ins: any = await admin.from("pr_posts").insert({ operator, kind: kind || "post", text, url });
    // text/url 列が未整備の環境では列エラーになるため、operator/kind のみで再挿入（後方互換）。
    if (ins?.error && /text|url|column/i.test(ins.error.message ?? "")) {
      await admin.from("pr_posts").insert({ operator, kind: kind || "post" });
    }
    revalidateTag("dashboard", "max");
    return { ok: true };
  } catch { return { ok: false }; }
}
