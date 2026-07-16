// LP（ランディングページ）登録元の一元レジストリ。
//   「様々なLPから登録 → dxの新着で承認」を土台化するための、登録元(signup_source)の
//   表示ラベル・色の唯一の定義場所。新しいLPを足すときは SOURCES に1行追加するだけで、
//   新着タブ・人材一覧のバッジが自動で対応する（source を付けて登録テーブルに書く運用）。
//
//   source の値は enger.candidates.signup_source / public.profiles.signup_source /
//   coo_talent_entries.source と共通のキー。

export type SourceMeta = {
  /** 正規化後のキー。 */
  key: string;
  /** 一覧・詳細で使うフルラベル。 */
  label: string;
  /** バッジ用の短いラベル。 */
  short: string;
  /** バッジ色（文字色）。背景は薄色を自動生成。 */
  color: string;
};

// 既知の登録元。key は正規化後の値。
const SOURCES: Record<string, SourceMeta> = {
  coo_enger_jp:      { key: "coo_enger_jp",      label: "右腕COO（coo.enger.jp）",        short: "右腕COO",       color: "#7c3aed" },
  enger:             { key: "enger",             label: "ENGERフリーランス（enger.jp）",   short: "ENGERフリーランス", color: "#0095D9" },
  enger_lp_business: { key: "enger_lp_business", label: "エンジャービジネス（enger.jp）",  short: "エンジャービジネス", color: "#0b5cab" },
  dojo:              { key: "dojo",              label: "無限道場",                        short: "無限道場",       color: "#d97706" },
};

/** 生の signup_source 値を既知キーへ正規化（表記ゆれ吸収）。未知はそのまま返す。 */
export function normalizeSource(raw?: string | null): string | null {
  const s = String(raw ?? "").toLowerCase().trim();
  if (!s) return null;
  if (s === "coo_enger_jp" || s === "coo" || s === "coo_enger") return "coo_enger_jp";
  if (s === "enger" || s === "enger_lp" || s === "engerjp" || s === "enger.jp") return "enger";
  if (s === "enger_lp_business" || s === "business" || s === "enger_business") return "enger_lp_business";
  if (s === "dojo" || s === "mugen_dojo" || s === "mugendojo") return "dojo";
  return s; // 将来の新LP（保存値そのまま）
}

/** 登録元メタを返す。未知の source でも汎用ラベルで必ず返す（新LSでも破綻しない）。 */
export function sourceMeta(raw?: string | null): SourceMeta {
  const key = normalizeSource(raw);
  if (!key) return { key: "unknown", label: "登録元不明", short: "登録元不明", color: "#94a3b8" };
  const known = SOURCES[key];
  if (known) return known;
  // 未知のLP：キーをそのままラベル化（例 "acme_lp" → "acme_lp"）。色は汎用ブルー。
  return { key, label: `LP登録（${key}）`, short: key, color: "#4f46e5" };
}

/** バッジ用の淡い背景色を色から生成（HEX #rrggbb 前提。20% 相当の薄色）。 */
export function sourceBgFor(color: string): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  if (!m) return "#eef2ff";
  const r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
  return `rgba(${r}, ${g}, ${b}, 0.12)`;
}
