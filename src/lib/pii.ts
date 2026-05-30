// PII（個人情報）マスク。テナント隔離ロール(partner/freelance)やクライアントへ自由記述本文を
// 渡す前に、電話・メールアドレス・URL・固有名詞風キーワードを伏字化する保険。
//   完全な除去は不可能（人名等は文脈依存）なので、確実に検出できるパターンのみ置換する。
//   構造的隔離（共有時に本文を null にする）と併用すること（多層防御）。

// 日本の電話番号：固定 0xx-xxxx-xxxx / 携帯 070|080|090-xxxx-xxxx、ハイフン無しも
const PHONE_RE = /(?:\+?81[-\s]?\d{1,4}[-\s]?\d{1,4}[-\s]?\d{3,4}|0\d{1,4}[-\s]?\d{1,4}[-\s]?\d{3,4}|0[789]0\d{8}|\b\d{2,4}-\d{2,4}-\d{4}\b)/g;
// メールアドレス
const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
// http(s)/gmail等URL
const URL_RE = /https?:\/\/[^\s<>()"']+/g;
// 「○○です／○○まで／○○より／署名」の人名拾い（後方に「です」「まで」「より」「:」を含むカタカナ漢字氏名）
//   日本語の人名抽出は誤検出が多いので、明確に「担当者を表す合図句」が後ろにある場合のみ伏字化。
const NAME_AFTER_HINT = /([一-鿿々ヶ・゠-ヿA-Za-z]{2,8})\s*(?=(です|まで|より|宛|担当|です。|\s*[:：]))/g;
// 「株式会社○○」「○○株式会社」（10文字以内の会社名想定）
const COMPANY_RE = /(株式会社[一-鿿゠-ヿA-Za-z0-9]{1,16}|[一-鿿゠-ヿA-Za-z0-9]{1,16}株式会社)/g;

export type RedactOpts = {
  phone?: boolean;
  email?: boolean;
  url?: boolean;
  name?: boolean;
  company?: boolean;
};

const ALL: Required<RedactOpts> = { phone: true, email: true, url: true, name: true, company: true };

/** テキストから PII を伏字化（数字は ●、文字は ○ などで置換）。 */
export function redactPii(input?: string | null, opts: RedactOpts = ALL): string | null {
  if (input == null) return null;
  let s = String(input);
  if (!s) return s;
  if (opts.phone) s = s.replace(PHONE_RE, "[電話番号は非表示]");
  if (opts.email) s = s.replace(EMAIL_RE, "[メールアドレスは非表示]");
  if (opts.url) s = s.replace(URL_RE, "[URLは非表示]");
  if (opts.company) s = s.replace(COMPANY_RE, "[企業名は非表示]");
  if (opts.name) s = s.replace(NAME_AFTER_HINT, "[氏名は非表示]");
  return s;
}
