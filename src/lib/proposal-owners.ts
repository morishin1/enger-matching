// 提案者・クロージング担当の名前リスト（管理者が編集）。
//   app_settings(key='proposal_owners') に保存し、提案ボード/詳細モーダル/メール文の
//   選択肢として使う。「未割当」は内部で自動付与する（DBには保存しない）。
//   未設定時は staff（=app_users 由来）の名前リストにフォールバック。

import { engerAdmin, engerClient, dbConfigured } from "./supabase";

export const PROPOSAL_OWNERS_KEY = "proposal_owners";

export type ProposalOwners = { proposers: string[]; closers: string[] };

const trimUniq = (xs: any[]): string[] =>
  Array.from(new Set((xs ?? []).map((x) => String(x ?? "").trim()).filter(Boolean)));

// #338：名前のみメンバー（提案者）を個人KGI(person_kgi)のキーにするための合成 owner_email。
//   実メールは "@" を含むため衝突しない。保存側(persistKgi)は "name:" 接頭辞のとき
//   アカウントマスタ照合をスキップし、名前だけで個人KGIを保存できるようにする。
export function proposerMemberEmail(name: string): string {
  return "name:" + String(name ?? "").trim().toLowerCase();
}
export function isProposerMemberEmail(email: string | null | undefined): boolean {
  return /^name:/i.test(String(email ?? ""));
}

/** 提案者・クロージングの選択肢を読み込み（未設定は null を返してフォールバックさせる）。 */
export async function loadProposalOwners(): Promise<ProposalOwners | null> {
  if (!dbConfigured) return null;
  try {
    let sb: ReturnType<typeof engerClient>;
    try { sb = engerAdmin(); } catch { sb = engerClient(); }
    const { data, error } = await sb.from("app_settings").select("value").eq("key", PROPOSAL_OWNERS_KEY).maybeSingle();
    if (error || !data?.value) return null;
    const v = data.value as Partial<ProposalOwners>;
    const proposers = trimUniq(v.proposers ?? []);
    const closers = trimUniq(v.closers ?? []);
    if (!proposers.length && !closers.length) return null;
    return { proposers, closers };
  } catch { return null; }
}
