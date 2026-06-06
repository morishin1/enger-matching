// 自己登録アカウントの怪しさ判定（軽量・決定論的）。
//   UI で「⚠ 確認推奨」「🚨 スパム疑い」を出すために使う。承認判断の補助。
//   ・サーバ判定は不要（既に保存されている値だけで判断）。クライアントで実行。
//   ・誤検知より「見逃しを減らす」設計。理由は複数返す。

import { isDisposableEmail, isValidEmail } from "./signup-security";

export type SuspicionLevel = "warn" | "danger";
export type Suspicion = { level: SuspicionLevel; reasons: string[] } | null;

// 連続文字・ランダム英数字混在を雑に検出（例: asdfghjk, qwerty, xn93lso）。
const KEYBOARD_SEQ_RE = /(qwert|asdfg|zxcvb|12345|09876|abcde|0000|1111)/i;
// 「使い捨てっぽい」会社名・氏名（テストアカウント等）
const TEST_NAME_RE = /^(test|spam|sample|asdf|aaaa|user|hoge|fuga|piyo|名無し|テスト|sample test|admin|administrator)\s*\d*$/i;
const URL_LIKE_RE = /https?:\/\/|www\.|\.(com|net|jp|org|info|biz)\b/i;

// 怪しい SNS/連絡先プロモ的キーワード（メモ・会社名・氏名のいずれかに含まれていたら警告）
const SPAMMY_KEYWORDS_RE = /(投資|副業.*稼|無料|プレゼント|invest|crypto|forex|bitcoin|usdt|telegram|t\.me\/|whatsapp|kakao|wechat|line.*id|ライン.{0,3}id|配信停止|モニター|限定オファー)/i;

type AccountLike = {
  email?: string | null;
  name?: string | null;
  company_name?: string | null;
  note?: string | null;
  role?: string | null;
  created_at?: string | null;
  id?: string;
  signup_source?: string | null;
};

export function detectSuspicion(a: AccountLike): Suspicion {
  const reasons: string[] = [];
  let level: SuspicionLevel = "warn";

  const email = (a.email ?? "").toLowerCase().trim();
  const name = (a.name ?? "").trim();
  const company = (a.company_name ?? "").trim();
  const note = (a.note ?? "").trim();

  // メールの形式・素性
  if (email && !isValidEmail(email)) { reasons.push("メール形式が不正"); level = "danger"; }
  if (email && isDisposableEmail(email)) { reasons.push("使い捨てメールドメイン"); level = "danger"; }

  // メールローカル部の怪しさ：長すぎる・乱雑英数字・キーボード連打
  const local = email.split("@")[0] ?? "";
  if (local && local.length >= 20 && /^[a-z0-9]+$/.test(local) && /\d{3,}/.test(local)) {
    reasons.push("メールに無作為な英数字");
  }
  if (KEYBOARD_SEQ_RE.test(local)) reasons.push("メールにキーボード連打文字列");

  // 名前の素性
  if (TEST_NAME_RE.test(name) || TEST_NAME_RE.test(company)) { reasons.push("テスト用とおぼしき氏名/会社名"); level = "danger"; }
  if (KEYBOARD_SEQ_RE.test(name) || KEYBOARD_SEQ_RE.test(company)) reasons.push("氏名/会社名に連打文字列");

  // URL を仕込んでいる（プロフィール SPAM の典型）
  if (URL_LIKE_RE.test(name) || URL_LIKE_RE.test(company) || URL_LIKE_RE.test(note)) {
    reasons.push("氏名/会社名/メモにURL"); level = "danger";
  }
  // スパム勧誘ワード
  for (const field of [name, company, note]) {
    if (SPAMMY_KEYWORDS_RE.test(field)) { reasons.push("勧誘/投資/暗号資産系の文言"); level = "danger"; break; }
  }

  // 名前未設定 + LP登録（不明） は弱い警告
  if (!name && (a.id?.startsWith("profile:") || a.id?.startsWith("auth:")) && !a.signup_source) {
    reasons.push("氏名未設定（LP登録・登録元不明）");
  }
  // 自己登録の企業ロールなのに会社名空（フォームでは弾いているはずだが念のため）
  if (a.role === "client" && !company) reasons.push("企業区分なのに会社名なし");

  if (reasons.length === 0) return null;
  return { level, reasons };
}
