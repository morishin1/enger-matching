// 人材の登録元判定（純粋関数）。クライアント/サーバの両方から共用する。
//   ENGERフリーランス（LP経由）判定：signup_source が取得できないフォールバック時にも
//   消えないよう、source_csv=freelance／所属会社テキストでも判定する（#257 / #330）。
export function isEngerFreelance(x: any): boolean {
  return ["enger", "enger_lp", "engerjp"].includes(String(x?.signup_source ?? "").toLowerCase())
    || String(x?.source_csv ?? "").toLowerCase() === "freelance"
    || String(x?.source_company ?? x?.company ?? "").trim() === "ENGERフリーランス";
}

// 右腕COO（coo.enger.jp）判定：エージェント承認取込 coo_import_talent_entry が
// signup_source='coo_enger_jp' を付与する。
export function isCooTalent(x: any): boolean {
  return String(x?.signup_source ?? "").toLowerCase() === "coo_enger_jp";
}
