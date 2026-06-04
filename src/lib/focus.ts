import { engerClient, dbConfigured } from "./supabase";
import { DEFAULT_FOCUS_CRITERIA, EMPTY_RULE, type FocusCriteria } from "./focus-criteria";

const KEY = "focus_criteria";

/** app_settings から注力定義を読み込む（無ければ既定値）。サーバ専用。 */
export async function loadFocusCriteria(): Promise<FocusCriteria> {
  if (!dbConfigured) return DEFAULT_FOCUS_CRITERIA;
  try {
    const sb = engerClient();
    const { data, error } = await sb.from("app_settings").select("value").eq("key", KEY).maybeSingle();
    if (error || !data?.value) return DEFAULT_FOCUS_CRITERIA;
    const v = data.value as Partial<FocusCriteria>;
    return {
      candidates: { ...EMPTY_RULE, ...(v.candidates ?? {}) },
      jobs: { ...EMPTY_RULE, ...(v.jobs ?? {}) },
    };
  } catch { return DEFAULT_FOCUS_CRITERIA; }
}

export { KEY as FOCUS_SETTINGS_KEY };
