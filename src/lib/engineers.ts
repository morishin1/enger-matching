import { publicAdmin, dbConfigured } from "./supabase";

export type EngineerSkill = { name: string; level?: string; ratio?: number };
export type Engineer = {
  id: string;
  display_name: string | null;
  github_login: string | null;
  avatar_url: string | null;
  email: string | null;
  skills: EngineerSkill[];
  primary_language: string | null;
  total_stars: number;
  total_repos: number;
  estimated_pay_low: number | null;
  estimated_pay_mid: number | null;
  estimated_pay_high: number | null;
  created_at: string;
};

/** LP(enger.jp)で登録したエンジニア一覧（public.profiles・service role閲覧）。 */
export async function listEngineers(): Promise<{ rows: Engineer[]; available: boolean }> {
  if (!dbConfigured) return { rows: [], available: false };
  try {
    const sb = publicAdmin();
    const { data, error } = await sb
      .from("profiles")
      .select("id, display_name, github_login, avatar_url, email, skills, primary_language, total_stars, total_repos, estimated_pay_low, estimated_pay_mid, estimated_pay_high, created_at")
      // public.profiles は LMS と共有。enger.jp(LP)由来のエンジニアだけを表示する。
      //   - GitHub連携: github_id / github_login あり
      //   - メール登録: 登録時の表示名 display_name あり
      // LMS の受講生/スタッフは display_name/github 系がすべて NULL なので除外される。
      .or("github_id.not.is.null,github_login.not.is.null,display_name.not.is.null")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) return { rows: [], available: false };
    const rows = (data ?? []).map((r: any) => ({
      ...r,
      skills: Array.isArray(r.skills) ? r.skills : [],
      total_stars: r.total_stars ?? 0,
      total_repos: r.total_repos ?? 0,
    })) as Engineer[];
    return { rows, available: true };
  } catch { return { rows: [], available: false }; }
}
