// 個人KGI（部署 メンバー別KPI）の「対象メンバー名簿」。
//   app_settings(key='person_kgi_members') に保存：{ [department]: [{ email, name }] }
//   ・この名簿が設定されている部署は、名簿を“正”としてメンバー別KPIの対象にする
//     （＝アカウントの department 設定に依存せず、担当者を明示的に増減・改名できる）。
//   ・名簿が未設定の部署は従来どおりアカウント（status=active・agent/admin・当該 department）から自動表示。
//   ・person_kgi は owner_email をキーに保存するため、名簿メンバーは実在アカウントの email を持つ
//     （UIの追加候補は既存アカウントから選ぶ。管理者は全アカウント、マネージャーは自部署のみ）。
//   保存処理は person-kgi-members-actions.ts（"use server"）に分離。
import { engerAdmin, engerClient, dbConfigured } from "./supabase";

export const PERSON_KGI_MEMBERS_KEY = "person_kgi_members";

export type PersonKgiMember = { email: string; name: string };

/** 任意配列を {email, name} の正規化済みリストにする（email 重複・空は除去、最大200件）。 */
export function normalizePersonKgiMembers(arr: any): PersonKgiMember[] {
  if (!Array.isArray(arr)) return [];
  const seen = new Set<string>();
  const out: PersonKgiMember[] = [];
  for (const m of arr) {
    const email = String(m?.email ?? "").trim().toLowerCase();
    const name = String(m?.name ?? "").trim();
    if (!email || !name || seen.has(email)) continue;
    seen.add(email);
    out.push({ email, name });
    if (out.length >= 200) break;
  }
  return out;
}

type MembersBlob = Record<string, unknown>;

/** app_settings の person_kgi_members 全体（部署ごとのネスト）を取得。 */
export async function loadPersonKgiMembersBlob(): Promise<MembersBlob> {
  if (!dbConfigured) return {};
  try {
    let sb: ReturnType<typeof engerClient>;
    try { sb = engerAdmin(); } catch { sb = engerClient(); }
    const { data, error } = await sb.from("app_settings").select("value").eq("key", PERSON_KGI_MEMBERS_KEY).maybeSingle();
    if (error || !data?.value || typeof data.value !== "object") return {};
    return data.value as MembersBlob;
  } catch { return {}; }
}

/** 指定部署のメンバー名簿（未設定は空配列＝アカウント自動表示にフォールバック）。 */
export async function loadPersonKgiMembers(department: string): Promise<PersonKgiMember[]> {
  const blob = await loadPersonKgiMembersBlob();
  return normalizePersonKgiMembers(blob?.[department]);
}
