// 紹介元ポータル（/ref）の共通ロジック（サーバ専用）。
//   知り合い企業（人材を紹介してくれる会社）に、会員登録なしの簡易ログイン
//   （ID＋パスコード）で「自社が紹介した人材」と「マッチする案件」だけを見せる。
//   ・パスコードは HMAC ハッシュのみ保存（share/[token] の Cookie 方式と同型）。
//   ・案件のクライアント企業名・本文は出さない（担当仲介まで非公開＝直接取引の防止）。
import { createHmac } from "crypto";
import { cookies } from "next/headers";
import { engerAdmin } from "@/lib/supabase";
import { rankJobs, type Job, type Candidate } from "@/lib/match";

export const REF_EXPIRE_DAYS = 90;
/** ログイン連続失敗の上限（総当たり対策）。超えたら担当によるパスコード再発行が必要。 */
export const REF_MAX_FAILED_ATTEMPTS = 10;
/** 1人材あたりのマッチ案件表示数／表示する人材数の上限。 */
export const REF_JOBS_PER_CANDIDATE = 5;
export const REF_MAX_CANDIDATES = 20;

const SECRET = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "enger-referral";

export type ReferralPartner = {
  id: string;
  login_id: string;
  passcode_hash: string;
  company_name: string;
  created_by: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  failed_attempts: number;
  view_count: number | null;
};

/** パスコードのハッシュ（平文は保存しない）。 */
export function refPasscodeHash(loginId: string, passcode: string): string {
  return createHmac("sha256", SECRET).update(`refp:${loginId.toUpperCase()}:${passcode}`).digest("hex");
}

/** ログイン状態を覚える Cookie。値は「id.HMAC(id:passcode_hash)」。
 *  パスコード再発行（hash 変更）や停止で即失効する（毎回DB照合するため）。 */
export const REF_COOKIE = "ref_portal";
export function refCookieValue(partner: Pick<ReferralPartner, "id" | "passcode_hash">): string {
  const mac = createHmac("sha256", SECRET).update(`refc:${partner.id}:${partner.passcode_hash}`).digest("hex");
  return `${partner.id}.${mac}`;
}

export function refPartnerState(p: ReferralPartner): "ok" | "revoked" | "expired" | "locked" {
  if (p.revoked_at) return "revoked";
  if (p.expires_at && new Date(p.expires_at).getTime() < Date.now()) return "expired";
  if ((p.failed_attempts ?? 0) >= REF_MAX_FAILED_ATTEMPTS) return "locked";
  return "ok";
}

const PARTNER_COLS = "id, login_id, passcode_hash, company_name, created_by, expires_at, revoked_at, failed_attempts, view_count";

export async function getRefPartnerByLoginId(loginId: string): Promise<ReferralPartner | null> {
  const id = loginId.trim().toUpperCase();
  if (!/^[A-Z0-9-]{4,32}$/.test(id)) return null;
  try {
    const admin = engerAdmin();
    const r: any = await admin.from("referral_partners").select(PARTNER_COLS).eq("login_id", id).maybeSingle();
    return (r.data as ReferralPartner | null) ?? null;
  } catch { return null; }
}

/** Cookie からログイン中の紹介元を取得（無効・停止・期限切れは null）。 */
export async function getRefSession(): Promise<ReferralPartner | null> {
  try {
    const store = await cookies();
    const raw = store.get(REF_COOKIE)?.value ?? "";
    const [id, mac] = raw.split(".");
    if (!id || !mac || !/^[0-9a-f-]{36}$/i.test(id)) return null;
    const admin = engerAdmin();
    const r: any = await admin.from("referral_partners").select(PARTNER_COLS).eq("id", id).maybeSingle();
    const p = r.data as ReferralPartner | null;
    if (!p) return null;
    if (refCookieValue(p) !== raw) return null;               // hash 変更（再発行）で失効
    if (refPartnerState(p) !== "ok") return null;             // 停止・期限切れ・ロック
    return p;
  } catch { return null; }
}

/** 閲覧カウント（失敗しても表示は止めない）。 */
export async function bumpRefView(p: ReferralPartner): Promise<void> {
  try {
    const admin = engerAdmin();
    await admin.from("referral_partners")
      .update({ view_count: (p.view_count ?? 0) + 1, last_viewed_at: new Date().toISOString() })
      .eq("id", p.id);
  } catch { /* noop */ }
}

// ---- ポータル表示データ ------------------------------------------------------

export type RefJobCard = {
  job_no: number;
  title: string;
  role_label: string | null;
  salary: string;
  remote: string | null;
  start: string | null;
  score: number;
  matchedSkills: string[];
  requested: boolean;   // 「進めてほしい」依頼済み
};

export type RefCandidateCard = {
  candidate_no: number;
  initials: string;     // 表示名（イニシャル or 管理番号）
  title: string | null;
  skills: string[];
  rate: string;         // 単価表示
  avail: string | null;
  jobs: RefJobCard[];
};

const salaryLabel = (lo?: number | null, hi?: number | null) =>
  lo && hi ? (lo === hi ? `${lo}万円` : `${lo}〜${hi}万円`) : hi ? `〜${hi}万円` : lo ? `${lo}万円〜` : "スキル見合い";
const remoteLabel = (r?: string | null) =>
  r === "full_remote" ? "フルリモート" : r === "partial_remote" ? "一部リモート" : r === "onsite" ? "出社" : (r || null);

/** 紹介元企業の「紹介した人材」＋各人材のマッチ案件を読み込む。
 *  人材の紐付け：candidates.source_company の部分一致 or owner_company の一致。
 *  案件カードには クライアント名・本文 を一切含めない（匿名カードのみ）。 */
export async function loadReferralPortal(partner: ReferralPartner): Promise<RefCandidateCard[]> {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return []; }
  const company = partner.company_name.trim();
  if (!company) return [];

  // 人材：source_company 部分一致（メール取込の会社名）と owner_company 一致（パートナー登録）を統合。
  const candCols = "id, candidate_no, initials, title, skills, rate, rate_num, salary_min, salary_max, avail, remote_pref, age_band, nationality, affiliation, exp, status, is_closed, deleted_at";
  const candBase = "id, candidate_no, initials, title, skills, rate, salary_min, salary_max, avail, remote_pref, age_band, nationality, affiliation, exp";
  const fetchCands = async (cols: string) => {
    const [bySource, byOwner] = await Promise.all([
      admin.from("candidates").select(cols).ilike("source_company", `%${company}%`).order("created_at", { ascending: false }).limit(100),
      admin.from("candidates").select(cols).eq("owner_company", company).order("created_at", { ascending: false }).limit(100),
    ]);
    if (bySource.error && byOwner.error) throw bySource.error;
    const rows = [...(bySource.data ?? []), ...(byOwner.data ?? [])] as any[];
    const seen = new Set<string>();
    return rows.filter((c) => { const k = String(c.id); if (seen.has(k)) return false; seen.add(k); return true; });
  };
  let cands: any[] = [];
  try { cands = await fetchCands(candCols); } catch { try { cands = await fetchCands(candBase); } catch { return []; } }
  cands = cands
    .filter((c) => !c.deleted_at && !c.is_closed && c.candidate_no != null)
    .slice(0, REF_MAX_CANDIDATES);
  if (cands.length === 0) return [];

  // 案件プール：公開・募集中のもの（クライアント名は取得するがカードには出さない。
  //   detail はマッチングの国籍/年代判定にのみ使用し、表示には使わない）。
  const jobCols = "id, job_no, title, role_label, skills, salary_min, salary_max, remote_type, start_date, work_location, status, created_at, last_confirmed_at, detail, flow_note, accept_flow_depth, client_name, is_closed, deleted_at";
  const jobBase = "id, job_no, title, role_label, skills, salary_min, salary_max, remote_type, start_date, work_location, status, created_at, detail, flow_note, client_name";
  let jobs: any[] = [];
  try {
    let jr: any = await admin.from("jobs").select(jobCols).order("created_at", { ascending: false }).limit(1500);
    if (jr.error) jr = await admin.from("jobs").select(jobBase).order("created_at", { ascending: false }).limit(1500);
    jobs = (jr.data ?? []).filter((j: any) => !j.deleted_at && !j.is_closed && j.status !== "募集終了" && j.job_no != null);
  } catch { jobs = []; }

  // 依頼済み（この案件で進めてほしい）を取得してボタン状態に反映。
  const requested = new Set<string>();
  try {
    const rr: any = await admin.from("referral_requests").select("candidate_no, job_no").eq("partner_id", partner.id).limit(1000);
    for (const r of (rr.data ?? [])) requested.add(`${r.candidate_no}:${r.job_no}`);
  } catch { /* テーブル未整備でも表示は続行 */ }

  return cands.map((c: any) => {
    const cand: Candidate = {
      candidate_no: c.candidate_no, id: c.id, name: String(c.initials ?? ""), title: c.title,
      skills: c.skills, salary_min: c.salary_min, salary_max: c.salary_max, rate: c.rate, rate_num: c.rate_num,
      remote_pref: c.remote_pref, avail: c.avail, affiliation: c.affiliation, age_band: c.age_band,
      nationality: c.nationality, exp: c.exp, status: c.status,
    };
    const ranked = jobs.length ? rankJobs(cand, jobs as Job[], REF_JOBS_PER_CANDIDATE) : [];
    return {
      candidate_no: c.candidate_no,
      initials: String(c.initials ?? "").trim() || `P-${String(c.candidate_no).padStart(5, "0")}`,
      title: c.title ?? null,
      skills: Array.isArray(c.skills) ? c.skills.slice(0, 12) : [],
      rate: c.rate ? String(c.rate) : salaryLabel(c.salary_min, c.salary_max),
      avail: c.avail ?? null,
      jobs: ranked.map((r: any) => ({
        job_no: r.job.job_no,
        title: r.job.title ?? "案件",
        role_label: r.job.role_label ?? null,
        salary: salaryLabel(r.job.salary_min, r.job.salary_max),
        remote: remoteLabel(r.job.remote_type),
        start: r.job.start_date ? String(r.job.start_date).slice(0, 10) : null,
        score: r.score,
        matchedSkills: (r.matchedSkills ?? []).slice(0, 8),
        requested: requested.has(`${c.candidate_no}:${r.job.job_no}`),
      })),
    };
  });
}
