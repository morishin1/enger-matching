import { unstable_cache } from "next/cache";
import { publicAdmin, engerClient, dbConfigured } from "./supabase";

export type EngineerSkill = { name: string; level?: string; ratio?: number };

/**
 * 登録元の判別ルール（将来のLP追加に備え、ラベル文字列で持つ）。
 * 順に評価して最初に一致したものを採用。
 *   - signup_source 列が将来追加された場合はそれを最優先で使う
 *   - 現状は role / github_login / display_name から推定
 * 新しい LP やフォーム/Google 登録などを追加する場合は、profiles 側で
 * 何らかの識別子を保存し、ここに分岐を増やすだけで対応可能。
 */
export type EngineerSource = {
  key: string;        // 内部キー "dojo" "enger_github" 等
  label: string;      // 表示名 "無限道場LP" 等
  method?: string;    // 登録方式 "GitHub" "メール" 等（タグで表示）
  color: "warn" | "brand" | "accent" | "danger" | "neutral";
};

// LP/方式の表示名マップ（新しいLP/方式を追加する際はここに 1 行足すだけ）
const LP_LABEL: Record<string, { label: string; color: EngineerSource["color"] }> = {
  enger:      { label: "ENGERフリーランス", color: "brand" },
  enger_lp:   { label: "ENGERフリーランス", color: "brand" },
  dojo:       { label: "無限道場LP", color: "warn" },
  mugen_dojo: { label: "無限道場LP", color: "warn" },
};
const METHOD_LABEL: Record<string, string> = {
  github: "GitHub",
  google: "Google",
  form:   "フォーム",
  email:  "メール",
};

export function classifySource(p: any): EngineerSource {
  // 第1優先：profiles.signup_source / signup_method（LP側で明示保存された値）
  const ss = String(p?.signup_source ?? "").toLowerCase();
  const sm = String(p?.signup_method ?? "").toLowerCase();
  let lpKey = "";
  let methodKey = "";
  if (LP_LABEL[ss]) lpKey = (ss === "mugen_dojo") ? "dojo" : (ss === "enger_lp" ? "enger" : ss);
  if (METHOD_LABEL[sm]) methodKey = sm;

  // 第2優先：既存データのヒューリスティック（列が空の場合のフォールバック）
  if (!lpKey) {
    if (p?.role === "student") lpKey = "dojo";
    else if (p?.github_login || p?.github_id || p?.display_name || p?.email) lpKey = "enger";
  }
  if (!methodKey) {
    if (p?.github_login || p?.github_id) methodKey = "github";
    else if (p?.display_name || p?.email) methodKey = "email";
  }

  const lp = LP_LABEL[lpKey];
  return {
    key: lpKey || "other",
    label: lp?.label ?? "その他",
    // ENGERフリーランス(enger)は「ENGERフリーランス」単体で表示する要望のため方式(·Google等)は出さない。
    method: lpKey === "enger" ? undefined : (METHOD_LABEL[methodKey] || undefined),
    color: lp?.color ?? "neutral",
  };
}

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
  headline: string | null;
  bio: string | null;
  qiita_id: string | null;
  last_login_at: string | null;
  created_at: string;
  name: string | null;        // 無限道場(role=student)の表示名フォールバック
  role: string | null;
  phone: string | null;       // 連絡先：電話
  contact_line: string | null; // 連絡先：LINE/メッセージID
  // 退会関連（LP側で本人が「退会する」を押すと withdrawal_requested_at が立つ。
  //   営業が /engineers の詳細から「退会処理する」を押すと withdrawal_completed_at が立つ。
  //   フラグなので実削除ではなく「無効化」運用）。
  withdrawal_requested_at: string | null;
  withdrawal_reason: string | null;
  withdrawal_completed_at: string | null;
  source: EngineerSource;     // 派生フィールド（UIバッジ用）
};

// ENGER の人材一覧に出すべきでない登録経路（外部システム由来）。
//   LMS(学習管理)は「登録＝auth.users作成」のため public.profiles に行が混入する。
//   profiles 側に明示の経路列が無いケースもあるため、signup_source / source /
//   （auth metadata 由来の）app のいずれかが該当値なら除外する。
//   無限道場（mugen_dojo / dojo / 無限道場LP）も DX の LP登録一覧には出さない（要望）。
export const EXCLUDED_SIGNUP_SOURCES = new Set(["lms", "mugen_dojo", "dojo"]);
// 表記ゆれ（"無限道場LP" 等）も拾うための部分一致キーワード。
const EXCLUDED_SOURCE_KEYWORDS = ["lms", "mugen", "dojo", "無限道場", "無限"];

/** その profiles 行（または auth metadata）が除外対象の登録経路か。 */
export function isExcludedProfile(p: any): boolean {
  for (const key of ["signup_source", "source", "app"]) {
    const v = String(p?.[key] ?? "").toLowerCase().trim();
    if (!v) continue;
    if (EXCLUDED_SIGNUP_SOURCES.has(v)) return true;
    if (EXCLUDED_SOURCE_KEYWORDS.some((kw) => v.includes(kw.toLowerCase()))) return true;
  }
  return false;
}

/** LP(enger.jp)で登録したエンジニア一覧（public.profiles・service role閲覧）。 */
export async function listEngineers(): Promise<{ rows: Engineer[]; available: boolean }> {
  if (!dbConfigured) return { rows: [], available: false };
  try {
    const sb = publicAdmin();
    // signup_source / signup_method 列は将来 LP 側で追加される想定。
    // 列が無い環境でも落ちないように、まず rich select →エラー時にフォールバック。
    const base = "id, display_name, github_login, avatar_url, email, skills, primary_language, total_stars, total_repos, estimated_pay_low, estimated_pay_mid, estimated_pay_high, portfolio_url, skill_sheet_url, skill_sheet_name, headline, bio, qiita_id, last_login_at, created_at, name, role";
    // 連絡先(電話/メッセージ)の列名は LP によって異なる。よく使われる別名を順に試し、
    // 取れた行から後段でマッピング解決する。列が無い環境でも落ちないようフォールバック。
    //   電話     : phone / phone_number / tel / mobile
    //   メッセージ: contact_line / line / line_id / messenger / message_app
    // 退会関連列（withdrawal_requested_at / withdrawal_reason / withdrawal_completed_at）は
    //   supabase/profiles-withdrawal.sql で追加。未マイグレ環境では列無しフォールバックに落ちる。
    const wd = "withdrawal_requested_at, withdrawal_reason, withdrawal_completed_at";
    const richVariants = [
      // source 列がある環境ではそれも取得して LMS 等の除外に使う（無ければ下のフォールバックへ）。
      `${base}, signup_source, signup_method, source, phone, contact_line, ${wd}`,
      `${base}, signup_source, signup_method, source, ${wd}`,
      `${base}, signup_source, signup_method, source`,
      `${base}, signup_source, signup_method, phone, contact_line, ${wd}`,
      `${base}, signup_source, signup_method, phone_number, line_id, ${wd}`,
      `${base}, signup_source, signup_method, tel, messenger, ${wd}`,
      `${base}, signup_source, signup_method, ${wd}`,
      `${base}, ${wd}`,
      `${base}, signup_source, signup_method, phone, contact_line`,
      `${base}, signup_source, signup_method, phone_number, line_id`,
      `${base}, signup_source, signup_method, tel, messenger`,
      `${base}, signup_source, signup_method`,
      base,
    ];
    const orFilter = "github_id.not.is.null,github_login.not.is.null,display_name.not.is.null,role.eq.student";
    let data: any[] | null = null;
    for (const sel of richVariants) {
      const r: any = await sb.from("profiles").select(sel).or(orFilter).order("created_at", { ascending: false }).limit(500);
      if (!r.error) { data = r.data ?? []; break; }
    }
    if (data == null) return { rows: [], available: false };
    // 外部システム由来（LMS 等）の混入行を除外する。
    data = data.filter((r: any) => !isExcludedProfile(r));
    // 連絡先の別名を吸収して統一プロパティに正規化（phone / contact_line）。
    const phoneOf = (r: any) => r.phone ?? r.phone_number ?? r.tel ?? r.mobile ?? null;
    const lineOf = (r: any) => r.contact_line ?? r.line_id ?? r.line ?? r.messenger ?? r.message_app ?? null;
    const rows = (data ?? []).map((r: any) => ({
      ...r,
      skills: Array.isArray(r.skills) ? r.skills : [],
      total_stars: r.total_stars ?? 0,
      total_repos: r.total_repos ?? 0,
      phone: phoneOf(r),
      contact_line: lineOf(r),
      // 列が無い環境では undefined になるため null に正規化（UI 判定を簡潔に）。
      withdrawal_requested_at: r.withdrawal_requested_at ?? null,
      withdrawal_reason: r.withdrawal_reason ?? null,
      withdrawal_completed_at: r.withdrawal_completed_at ?? null,
      source: classifySource(r),
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

/** 企業からの人材リクエスト（enger.talent_interest）。営業が確認・対応する。60秒キャッシュ。 */
export const listTalentRequests = unstable_cache(async (): Promise<TalentRequest[]> => {
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
}, ["talent-requests"], { revalidate: 60, tags: ["dashboard", "sidebar-counts"] });

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
  /** @deprecated LP互換のためテーブル列としては残置。dx 側の進捗判定には常に stage を用いる */
  status?: string;
  stage: string;
  created_at: string;
  /** 案件マスタから補完（応募一覧で案件詳細・元メールに辿れるようにする・派生フィールド） */
  source_mail_url?: string | null;
};

/** エンジニアからの応募（enger.applications）。engineer_id でグルーピング。
 *  案件名だけだと詳細に辿れないため、jobs マスタを引いて job_no（詳細リンク用）と
 *  source_mail_url（元メールリンク用）を各応募に補完する。 */
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
    const apps = (data ?? []) as Application[];

    // 案件マスタ参照用のキーを収集（job_id 優先・無ければ job_no）。
    const jobIds = Array.from(new Set(apps.map((a) => a.job_id).filter(Boolean))) as string[];
    const jobNos = Array.from(new Set(apps.map((a) => a.job_no).filter(Boolean))) as string[];
    const byId = new Map<string, { job_no: string | null; source_mail_url: string | null }>();
    const byNo = new Map<string, { job_no: string | null; source_mail_url: string | null }>();
    try {
      if (jobIds.length > 0) {
        const jr: any = await sb.from("jobs").select("id, job_no, source_mail_url").in("id", jobIds).limit(2000);
        for (const j of (jr.data ?? [])) byId.set(String(j.id), { job_no: j.job_no != null ? String(j.job_no) : null, source_mail_url: j.source_mail_url ?? null });
      }
      const missingNos = jobNos.filter((n) => !Array.from(byId.values()).some((v) => v.job_no === n));
      if (missingNos.length > 0) {
        const jr2: any = await sb.from("jobs").select("id, job_no, source_mail_url").in("job_no", missingNos).limit(2000);
        for (const j of (jr2.data ?? [])) byNo.set(String(j.job_no), { job_no: j.job_no != null ? String(j.job_no) : null, source_mail_url: j.source_mail_url ?? null });
      }
    } catch { /* source_mail_url 列が無い古い環境でも応募一覧は出す */ }

    const map: Record<string, Application[]> = {};
    for (const r of apps) {
      const hit = (r.job_id && byId.get(r.job_id)) || (r.job_no && byNo.get(r.job_no)) || null;
      if (hit) {
        if (!r.job_no && hit.job_no) r.job_no = hit.job_no;
        r.source_mail_url = hit.source_mail_url;
      }
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
