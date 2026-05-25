"use server";

import { revalidatePath } from "next/cache";
import { engerAdmin } from "@/lib/supabase";
import { currentAccess } from "@/lib/accounts";
import { loadFocusCriteria, FOCUS_SETTINGS_KEY } from "@/lib/focus";
import { EMPTY_RULE, type FocusCriteria } from "@/lib/focus-criteria";

/** 注力定義を取得（クライアント/サーバ両方から呼べる server action）。 */
export async function getFocusCriteria(): Promise<FocusCriteria> {
  return loadFocusCriteria();
}

const sanitizeRule = (r: any) => ({
  minRate: r?.minRate == null || r?.minRate === "" ? null : Number(r.minRate),
  skills: Array.isArray(r?.skills) ? r.skills.map((s: any) => String(s).trim()).filter(Boolean) : [],
  keywords: Array.isArray(r?.keywords) ? r.keywords.map((s: any) => String(s).trim()).filter(Boolean) : [],
  note: String(r?.note ?? "").slice(0, 1000),
});

/** 注力定義を保存（管理者のみ）。 */
export async function saveFocusCriteria(input: FocusCriteria): Promise<{ ok: boolean; error?: string }> {
  const access = await currentAccess();
  if (access && access.role !== "admin") return { ok: false, error: "権限がありません（管理者のみ）" };
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }
  const value: FocusCriteria = {
    candidates: { ...EMPTY_RULE, ...sanitizeRule(input?.candidates) },
    jobs: { ...EMPTY_RULE, ...sanitizeRule(input?.jobs) },
  };
  const { error } = await admin.from("app_settings").upsert({ key: FOCUS_SETTINGS_KEY, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings"); revalidatePath("/people"); revalidatePath("/jobs"); revalidatePath("/matching");
  return { ok: true };
}
