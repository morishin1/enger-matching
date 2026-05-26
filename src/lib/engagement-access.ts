import type { Role } from "./roles";

/**
 * 原価・粗利を閲覧できるか（権限 × 所属区分）。
 *  - 管理者: 全て可
 *  - 一般(営業): BP / フリーランス は可（交渉に必要）。プロパー・不明は不可（給与漏洩防止）
 *  - それ以外: 不可
 * ※ プロパー給与の保護のため、所属区分が不明な行も一般には見せない（安全側）。
 */
export function canSeeMargin(role: Role | null | undefined, affiliation?: string | null): boolean {
  if (role === "admin") return true;
  if (role === "agent") {
    const a = affiliation ?? "";
    // BP / FL（フリーランス）は原価開示可。PP（プロパー）・不明は給与保護で非開示。
    return /\bBP\b|\bFL\b|フリー|業務委託|個人事業|partner/i.test(a);
  }
  return false;
}

export type MaskedEngagement = Record<string, any> & { _maskMargin: boolean };

/** サーバ側で原価/粗利をマスクして返す（クライアントには値を渡さない）。 */
export function maskEngagement(row: Record<string, any>, role: Role | null | undefined): MaskedEngagement {
  if (canSeeMargin(role, row.affiliation)) return { ...row, _maskMargin: false };
  // 値そのものをクライアントへ送らない
  const { cost, ...rest } = row;
  return { ...rest, cost: undefined, _maskMargin: true };
}
