import { publicAdmin, engerClient, dbConfigured } from "./supabase";

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
  portfolio_url: string | null;
  skill_sheet_url: string | null;
  skill_sheet_name: string | null;
  created_at: string;
};

/** LP(enger.jp)で登録したエンジニア一覧（public.profiles・service role閲覧）。 */
export async function listEngineers(): Promise<{ rows: Engineer[]; available: boolean }> {
  if (!dbConfigured) return { rows: [], available: false };
  try {
    const sb = publicAdmin();
    const { data, error } = await sb
      .from("profiles")
      .select("id, display_name, github_login, avatar_url, email, skills, primary_language, total_stars, total_repos, estimated_pay_low, estimated_pay_mid, estimated_pay_high, portfolio_url, skill_sheet_url, skill_sheet_name, created_at")
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

export type EngineerAction = {
  id: string;
  engineer_id: string;
  engineer_name: string | null;
  action: string;
  note: string | null;
  operator: string | null;
  created_at: string;
};

/** 全エンジニアへの対応履歴（enger.engineer_actions）。engineer_id でグルーピングして使う。 */
export async function listEngineerActions(): Promise<Record<string, EngineerAction[]>> {
  if (!dbConfigured) return {};
  try {
    const sb = engerClient();
    const { data, error } = await sb
      .from("engineer_actions")
      .select("id, engineer_id, engineer_name, action, note, operator, created_at")
      .order("created_at", { ascending: false })
      .limit(2000);
    if (error) return {};
    const map: Record<string, EngineerAction[]> = {};
    for (const r of (data ?? []) as EngineerAction[]) {
      (map[r.engineer_id] ??= []).push(r);
    }
    return map;
  } catch { return {}; }
}

export type TalentRequest = {
  id: string;
  company: string;
  kind: "candidate" | "profile";
  candidate_id: string | null;
  engineer_id: string | null;
  label: string | null;
  status: string;
  created_at: string;
};

/** 企業からの人材リクエスト（enger.talent_interest）。営業が確認・対応する。 */
export async function listTalentRequests(): Promise<TalentRequest[]> {
  if (!dbConfigured) return [];
  try {
    const sb = engerClient();
    const { data, error } = await sb
      .from("talent_interest")
      .select("id, company, kind, candidate_id, engineer_id, label, status, created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) return [];
    return (data ?? []) as TalentRequest[];
  } catch { return []; }
}

export type Scout = {
  id: string;
  engineer_id: string;
  engineer_name: string | null;
  agent: string | null;
  job_title: string | null;
  message: string;
  status: "sent" | "read" | "interested" | "declined";
  reply: string | null;
  created_at: string;
  read_at: string | null;
  replied_at: string | null;
};

export const APPLICATION_STAGES = ["応募", "書類選考", "面談", "面談合格", "稼働", "見送り"] as const;

export type Application = {
  id: string;
  engineer_id: string;
  engineer_name: string | null;
  job_id: string | null;
  job_no: string | null;
  job_title: string | null;
  message: string | null;
  status: string;
  stage: string;
  created_at: string;
};

/** エンジニアからの応募（enger.applications）。engineer_id でグルーピング。 */
export async function listApplications(): Promise<Record<string, Application[]>> {
  if (!dbConfigured) return {};
  try {
    const sb = engerClient();
    const { data, error } = await sb
      .from("applications")
      .select("id, engineer_id, engineer_name, job_id, job_no, job_title, message, status, stage, created_at")
      .order("created_at", { ascending: false })
      .limit(2000);
    if (error) return {};
    const map: Record<string, Application[]> = {};
    for (const r of (data ?? []) as Application[]) {
      (map[r.engineer_id] ??= []).push(r);
    }
    return map;
  } catch { return {}; }
}

/** 全エンジニアへのスカウト（enger.scouts）。engineer_id でグルーピングして使う。 */
export async function listScouts(): Promise<Record<string, Scout[]>> {
  if (!dbConfigured) return {};
  try {
    const sb = engerClient();
    const { data, error } = await sb
      .from("scouts")
      .select("id, engineer_id, engineer_name, agent, job_title, message, status, reply, created_at, read_at, replied_at")
      .order("created_at", { ascending: false })
      .limit(2000);
    if (error) return {};
    const map: Record<string, Scout[]> = {};
    for (const r of (data ?? []) as Scout[]) {
      (map[r.engineer_id] ??= []).push(r);
    }
    return map;
  } catch { return {}; }
}
