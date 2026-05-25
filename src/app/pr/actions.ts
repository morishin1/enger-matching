"use server";

import { revalidateTag } from "next/cache";
import { engerAdmin } from "@/lib/supabase";
import { currentAccess } from "@/lib/accounts";

/** /pr で「Xに投稿」したことを記録。ダッシュボードのPRアラート・担当別PR実施状況に使用。best-effort。 */
export async function logPrPost(kind: string): Promise<{ ok: boolean }> {
  try {
    const access = await currentAccess();
    const operator = access?.name || access?.email || null;
    const admin = engerAdmin();
    await admin.from("pr_posts").insert({ operator, kind: kind || "post" });
    revalidateTag("dashboard", "max");
    return { ok: true };
  } catch { return { ok: false }; }
}
