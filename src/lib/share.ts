// 外部共有リンク（/share/<token>）の共通ロジック（サーバ専用）。
//   ・リンク台帳(enger.share_links)の取得と状態判定
//   ・公開ページに出してよい「匿名サマリ」への変換（人材＝イニシャル＋スキル＋単価。
//     氏名・所属会社・連絡先・元メール・スキルシートは出さない。案件＝クライアント名・本文は出さない）
//   ・パスコード通過を覚える Cookie の名前/値（sha256）
import { createHmac } from "crypto";
import { engerAdmin } from "@/lib/supabase";
import { redactPii } from "@/lib/pii";
import { classifyJobFlow, JOB_FLOW_LABEL } from "@/lib/flow";
import {
  classifyCandNationality, CAND_NAT_LABEL,
  classifyJobNationality, JOB_NAT_LABEL, classifyJobAge,
} from "@/lib/nationality";

export const SHARE_BASE = (process.env.NEXT_PUBLIC_SITE_URL || "https://dx.enger.jp").replace(/\/$/, "");
export const SHARE_EXPIRE_DAYS = 30;

export type ShareLink = {
  id: string;
  token: string;
  kind: "job" | "candidate";
  job_no: number | null;
  candidate_no: number | null;
  passcode: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  view_count: number | null;
  passcode_attempts?: number | null;
  response?: string | null;       // 閲覧者の回答（興味あり / 見送り）
  responded_at?: string | null;
};

export type ShareLinkState = "ok" | "expired" | "revoked" | "locked";

/** パスコードの連続失敗上限（総当たり対策）。超えたらリンクごと無効＝再発行が必要。 */
export const SHARE_MAX_PASSCODE_ATTEMPTS = 30;

/** トークンの妥当性（base64url 文字のみ・長さ）。URL/リダイレクト先の組み立てに使う前に必ず通す。 */
export function isValidShareToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{10,64}$/.test(token);
}

export function shareUrl(token: string): string {
  return `${SHARE_BASE}/share/${token}`;
}

/** パスコード通過を覚える Cookie。値はサーバ秘密鍵による HMAC（＝秘密鍵を知らない外部からは
 *  偽造不能）。単純な sha256(token:passcode) だと Cookie を自作して 6桁を総当たりでき、
 *  フォーム側の試行回数制限（passcode_attempts）を素通りしてしまうため必ず HMAC にする。 */
const COOKIE_SECRET = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "enger-share-cookie";
export function shareCookieName(token: string): string {
  return `share_ok_${token.slice(0, 12)}`;
}
export function shareCookieValue(token: string, passcode: string): string {
  return createHmac("sha256", COOKIE_SECRET).update(`${token}:${passcode}`).digest("hex");
}

export async function getShareLink(token: string): Promise<ShareLink | null> {
  if (!isValidShareToken(token)) return null;
  try {
    const admin = engerAdmin();
    // passcode_attempts / response はマイグレーション未適用の環境もあるため、無い場合は列なしで再取得。
    let r: any = await admin
      .from("share_links")
      .select("id, token, kind, job_no, candidate_no, passcode, expires_at, revoked_at, view_count, passcode_attempts, response, responded_at")
      .eq("token", token)
      .maybeSingle();
    if (r.error) {
      r = await admin
        .from("share_links")
        .select("id, token, kind, job_no, candidate_no, passcode, expires_at, revoked_at, view_count")
        .eq("token", token)
        .maybeSingle();
    }
    return (r.data as ShareLink | null) ?? null;
  } catch {
    return null;
  }
}

export function shareLinkState(link: ShareLink): ShareLinkState {
  if (link.revoked_at) return "revoked";
  if (link.expires_at && new Date(link.expires_at).getTime() < Date.now()) return "expired";
  if (link.passcode && (link.passcode_attempts ?? 0) >= SHARE_MAX_PASSCODE_ATTEMPTS) return "locked";
  return "ok";
}

/** 閲覧カウント（失敗しても表示は止めない）。 */
export async function bumpShareView(link: ShareLink): Promise<void> {
  try {
    const admin = engerAdmin();
    await admin.from("share_links")
      .update({ view_count: (link.view_count ?? 0) + 1, last_viewed_at: new Date().toISOString() })
      .eq("id", link.id);
  } catch { /* noop */ }
}

// ---- 表示ラベル（公開ページ用の小ヘルパ） ------------------------------------
const salaryLabel = (lo?: number | null, hi?: number | null) =>
  lo && hi ? (lo === hi ? `${lo}万円` : `${lo}〜${hi}万円`) : hi ? `〜${hi}万円` : lo ? `${lo}万円〜` : "スキル見合い";
const jobRemoteLabel = (r?: string | null) =>
  r === "full_remote" ? "フルリモート" : r === "partial_remote" ? "一部リモート" : r === "onsite" ? "出社" : (r || null);
const candRemoteLabel = (r?: string | null) => {
  const s = (r ?? "").trim();
  if (!s) return null;
  if (s === "full_remote" || (/フル|完全/.test(s) && /リモート|在宅/.test(s))) return "フルリモート希望";
  if (s === "partial_remote" || /リモート|在宅/.test(s)) return "一部リモート希望";
  if (s === "onsite" || /出社|常駐/.test(s)) return "出社可";
  return s;
};

/** 公開ページに表示する1項目（ラベル＋値）。 */
export type ShareRow = { label: string; value: string };

/** 公開ページの匿名サマリ。job / candidate 共通の描画用フォーマット。 */
export type ShareView = {
  kind: "job" | "candidate";
  heading: string;        // 見出し（案件名 / イニシャル）
  subheading: string;     // 管理番号（No.xxxxx / P-xxxxx）
  rows: ShareRow[];
  skills: string[];
  summary: string | null; // 概要（案件のみ：本文から社名・氏名・連絡先・URLを伏字化した抜粋）
  closed: boolean;        // 充足/クローズ済み（注意書きを出す）
};

/** 案件本文を外部掲載用に整形：取込タグ（[削除スキル: …] 以降）を落とし、
 *  社名・氏名・連絡先・URL を伏字化して先頭 1200 文字を抜粋する。 */
function jobDetailSummary(detail?: string | null): string | null {
  if (!detail) return null;
  let s = String(detail).replace(/\r\n/g, "\n");
  const cut = s.search(/\[?\s*削除スキル[:：]/);
  if (cut >= 0) s = s.slice(0, cut);
  // 電話・メール・URL・「株式会社○○」は redactPii で伏字化。
  //   氏名だけは redactPii の name ルールを使わない（「金額：」「精算：」等のラベル行まで
  //   伏せてしまい本文が読めなくなるため）。誤検知の少ない下記2パターンに限定する。
  s = redactPii(s, { phone: true, email: true, url: true, company: true, name: false }) ?? "";
  s = s.replace(/[一-鿿々ヶ゠-ヿ]{2,6}\s*と申します/g, "[氏名は非表示]と申します"); // 自己紹介（○○と申します）
  s = s.replace(/(担当|担当者|窓口|営業)\s*[:：]\s*[一-鿿々ヶ゠-ヿA-Za-zＡ-Ｚａ-ｚ]{2,12}/g, "$1：[氏名は非表示]"); // 担当：○○
  s = s.replace(/\n{3,}/g, "\n\n").trim();
  if (!s) return null;
  return s.length > 1200 ? `${s.slice(0, 1200)}…` : s;
}

/** リンクの対象（案件 or 人材）を取得し、公開してよい形に変換する。 */
export async function loadShareView(link: ShareLink): Promise<ShareView | null> {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return null; }

  if (link.kind === "job" && link.job_no != null) {
    const base = "job_no, title, role_label, skills, salary_min, salary_max, remote_type, work_location, start_date, flow_note, detail, status, is_closed";
    let r: any = await admin.from("jobs").select(base).eq("job_no", link.job_no).maybeSingle();
    if (r.error) r = await admin.from("jobs").select("job_no, title, role_label, skills, salary_min, salary_max, remote_type, work_location, detail").eq("job_no", link.job_no).maybeSingle();
    const j = r.data;
    if (!j) return null;
    // クライアント名・本文(detail)・連絡先は外部に出さない。年代/国籍要件は本文から判定した「区分ラベル」のみ出す。
    const nat = JOB_NAT_LABEL[classifyJobNationality(j.detail, j.title)];
    const age = classifyJobAge(j.detail, j.title).label;
    const remote = jobRemoteLabel(j.remote_type);
    // 商流は flow_note の生文（自由文＝エンド企業名等が混ざりうる）をそのまま出さず、
    //   正規カテゴリのラベル（貴社まで/貴社一社まで…）に落として表示する（商流保護）。
    const flowCat = classifyJobFlow(j.flow_note);
    const rows: ShareRow[] = [];
    if (j.role_label) rows.push({ label: "職種", value: j.role_label });
    rows.push({ label: "単価", value: salaryLabel(j.salary_min, j.salary_max) });
    if (remote || j.work_location) rows.push({ label: "勤務", value: [remote, j.work_location].filter(Boolean).join(" / ") });
    if (j.start_date) rows.push({ label: "開始", value: String(j.start_date).slice(0, 10) });
    if (flowCat !== "unknown") rows.push({ label: "商流", value: JOB_FLOW_LABEL[flowCat] });
    // 「不明」の行は外部には出さない（情報が無いだけなのに制限があるように読めるため）。
    if (age && age !== "不明") rows.push({ label: "年代", value: age });
    if (nat && nat !== "不明") rows.push({ label: "国籍要件", value: nat });
    return {
      kind: "job",
      heading: j.title ?? "案件",
      subheading: `No.${String(j.job_no).padStart(5, "0")}`,
      rows,
      skills: Array.isArray(j.skills) ? j.skills.slice(0, 20) : [],
      // 詳細が少なすぎる問題への対応：本文（精算・面談回数・備考等が書かれている）を
      // 社名・氏名・連絡先・URLを伏字化したうえで「案件概要」として掲載する。
      summary: jobDetailSummary(j.detail),
      closed: !!j.is_closed,
    };
  }

  if (link.kind === "candidate" && link.candidate_no != null) {
    const base = "candidate_no, initials, title, affiliation, skills, rate, salary_min, salary_max, avail, location, exp, remote_pref, age_band, nationality, skill_level, japanese_level";
    let r: any = await admin.from("candidates").select(`${base}, is_closed`).eq("candidate_no", link.candidate_no).maybeSingle();
    if (r.error) r = await admin.from("candidates").select(base).eq("candidate_no", link.candidate_no).maybeSingle();
    const c = r.data;
    if (!c) return null;
    // 匿名規約：イニシャル＋スキル＋単価。氏名・所属会社・連絡先・元メール・スキルシートは出さない。
    //   イニシャル未登録の人材は管理番号のみを見出しにする（氏名からの推測文字も出さない）。
    const initials = String(c.initials ?? "").trim();
    const remote = candRemoteLabel(c.remote_pref);
    // 経験は「数値（年数）」のときだけ表示する。自由文の exp は経歴サマリで、
    //   前職の社名・案件名など特定につながる情報が混ざりうるため外部には出さない。
    const expYears = c.exp != null && /^\d+$/.test(String(c.exp).trim()) ? `${String(c.exp).trim()}年` : null;
    const rows: ShareRow[] = [];
    if (c.title) rows.push({ label: "職種", value: String(c.title) });
    if (c.age_band) rows.push({ label: "年齢層", value: String(c.age_band) });
    // 「不明」は外部には出さない（情報が無いだけのため）。
    const natLabel = CAND_NAT_LABEL[classifyCandNationality(c.nationality)];
    if (natLabel && natLabel !== "不明") rows.push({ label: "国籍", value: natLabel });
    rows.push({ label: "単価", value: c.rate ? String(c.rate) : salaryLabel(c.salary_min, c.salary_max) });
    if (remote) rows.push({ label: "リモート", value: remote });
    if (c.location) rows.push({ label: "最寄駅", value: String(c.location) });
    if (c.avail) rows.push({ label: "稼働開始", value: String(c.avail) });
    if (expYears) rows.push({ label: "経験", value: expYears });
    if (c.japanese_level) rows.push({ label: "日本語", value: String(c.japanese_level) });
    if (c.skill_level) rows.push({ label: "スキルレベル", value: String(c.skill_level) });
    return {
      kind: "candidate",
      heading: initials || `人材 P-${String(c.candidate_no).padStart(5, "0")}`,
      subheading: `P-${String(c.candidate_no).padStart(5, "0")}`,
      rows,
      skills: Array.isArray(c.skills) ? c.skills.slice(0, 20) : [],
      // 人材は匿名規約（イニシャル＋スキル＋単価）のため、自由文の経歴・本文は掲載しない。
      summary: null,
      closed: !!c.is_closed,
    };
  }

  return null;
}

/** 「テキストをコピー」用の整形文（公開ページと同じ内容のプレーンテキスト版）。 */
export function shareViewText(view: ShareView, url: string): string {
  const head = view.kind === "job" ? `【案件のご案内】${view.heading}` : `【人材のご紹介（匿名）】${view.heading}`;
  return [
    head,
    ...view.rows.map((r) => `■${r.label}：${r.value}`),
    view.skills.length ? `■スキル：${view.skills.slice(0, 12).join(" / ")}` : "",
    view.summary ? `\n■概要（社名・連絡先は非表示）\n${view.summary}` : "",
    "",
    view.kind === "candidate" ? "※氏名・連絡先・所属は ENGER 担当が仲介いたします。" : "※詳細は ENGER 担当までお問い合わせください。",
    `▼共有ページ（有効期限あり）`,
    url,
  ].filter(Boolean).join("\n");
}
