import { engerAdmin, dbConfigured } from "./supabase";

export type ReferralStatus = "new" | "contacted" | "registered" | "closed";
export type ClientReferral = {
  id: string;
  initials: string | null;
  title: string | null;
  skills: string[];
  rate: string | null;
  exp: string | null;
  avail: string | null;
  location: string | null;
  note: string | null;
  status: ReferralStatus;
  registered_candidate_no: number | null;
  created_at: string;
};

// docs/business-dashboard-v2-仕様.md §4：モーダル下部に紹介履歴＋対応状況を表示するための表記。
export const REFERRAL_STATUS_LABEL: Record<ReferralStatus, string> = {
  new: "未対応", contacted: "対応中", registered: "人材登録済", closed: "見送り",
};
export const REFERRAL_STATUS_TONE: Record<ReferralStatus, string> = {
  new: "#b45309", contacted: "#0b5cab", registered: "#067647", closed: "#6b7280",
};

/** 自社の紹介履歴（新しい順）。GET /api/public/candidate-referrals と同一クエリ・列。 */
export async function listReferralsByCompany(company: string): Promise<ClientReferral[]> {
  if (!dbConfigured || !company) return [];
  try {
    const sb = engerAdmin();
    const { data, error } = await sb.from("client_referrals")
      .select("id, initials, title, skills, rate, exp, avail, location, note, status, registered_candidate_no, created_at")
      .eq("company", company).order("created_at", { ascending: false }).limit(200);
    if (error || !data) return [];
    return data as ClientReferral[];
  } catch { return []; }
}
