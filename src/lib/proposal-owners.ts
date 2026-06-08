// 提案者・クロージング担当の名前リスト（管理者が編集）。
//   app_settings(key='proposal_owners') に保存し、提案ボード/詳細モーダル/メール文の
//   選択肢として使う。「未割当」は内部で自動付与する（DBには保存しない）。
//   未設定時は staff（=app_users 由来）の名前リストにフォールバック。

import { engerAdmin, engerClient, dbConfigured } from "./supabase";

export const PROPOSAL_OWNERS_KEY = "proposal_owners";

export type ProposalOwners = { proposers: string[]; closers: string[] };

const trimUniq = (xs: any[]): string[] =>
  Array.from(new Set((xs ?? []).map((x) => String(x ?? "").trim()).filter(Boolean)));

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
