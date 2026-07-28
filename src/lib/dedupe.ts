/**
 * 人材CSV取込の重複判定（管理NO #487 指示書）。
 *
 * ## 背景
 * 旧実装は「同姓同名は既存と統合する」オプションが**氏名のみ**で統合先を決めていた。
 * SES人材の氏名はイニシャル2文字が大半で衝突が日常的に起きるため、**別人の人材が
 * 登録されないまま消えていた**（2026-07-25 の実測で 27件中4件）。一方で本当の同一人物の
 * 重複は防げていなかった。この2方向の誤判定は重大度が違う：
 *
 *   - 別人を同一人物と誤判定 → 登録されず、気づく手段がない。復旧できない
 *   - 同一人物を別人と誤判定 → 重複登録される。一覧で見えるので手動削除できる
 *
 * したがって**迷う場合は「重複を許す側」に倒す**。この方針はこのモジュールの全判定に
 * 貫かれている（空欄条件のスキップ・単価が読めなければ不成立、等）。
 *
 * ## 判定の骨子
 * 6つの条件（DUP_CONDITIONS）の**どれか1つでも成立したら「登録済み」**（OR）。
 * 各条件の中は列挙された項目の**すべて一致**（AND）。
 * **条件を構成する項目が1つでも「未入力」なら、その条件は判定せずスキップする**
 * （空欄同士を一致とみなすと、最寄駅が空欄の10名が全員同一人物になる事故が起きる）。
 *
 * ## クライアント/サーバー境界
 * 純粋関数のみ。プレビュー画面（client）と取込サーバーアクションの両方から import する。
 * "use client" を付けないこと・Supabase 等に依存しないこと。
 */

/**
 * 「未入力」とみなす文字列（指示書 5.2。判定のスキップと補完対象の両方で同じ定義を使う）。
 *
 * 前後の空白（全角含む）を除去した後、このリストに完全一致するものを未入力として扱う。
 * 「空欄っぽい」曖昧判定はしない：ここに列挙された文字列**だけ**が未入力。
 *
 * ※ 5.2 の「要確認」事項：運用担当者が調査の結果として意図的に「不明」と入力している
 *   ケースが無いかは、運用側に確認が必要（ある場合はそのフィールドを FILL 対象から外す）。
 *   現状は初期値・プレースホルダとしての使用のみという前提。
 */
export const BLANK_TOKENS: readonly string[] = [
  "不明", "未定", "未設定", "要確認", "なし", "無し",
  "-",      // 半角ハイフン
  "－",     // 全角ハイフンマイナス (U+FF0D)
  "―",     // 水平線 (U+2015)
  "—",     // emダッシュ (U+2014)
  "–",     // enダッシュ (U+2013)
  "ー",     // 長音記号（単独で置かれた場合のみ。値の一部なら該当しない）
  "/", "／",
  "n/a", "N/A", "NA", "TBD", "tbd", "？", "?",
];

const BLANK_SET = new Set(BLANK_TOKENS.map((t) => t.toLowerCase()));

/** 前後の空白（全角含む）を除去 */
export const trimJa = (v: unknown): string => String(v ?? "").replace(/^[\s　]+|[\s　]+$/g, "");

/** 「未入力」か（指示書 5.2 の定義）。null / 空 / 空白のみ / BLANK_TOKENS への完全一致 */
export function isBlank(v: unknown): boolean {
  if (v == null) return true;
  const s = trimJa(v);
  if (!s) return true;
  return BLANK_SET.has(s.toLowerCase());
}

/**
 * 連絡先メールの比較値：**＠より後ろ（ドメイン部）だけ**を小文字化して返す（指示書 3.2）。
 * ＠より前は使わない。同じ会社の別担当（m-kobayashi@… と s-honda@…）を同一窓口として
 * 扱うため。ドメインが取れない値は null（＝未入力扱いで条件スキップ）。
 */
export function emailDomain(v: unknown): string | null {
  if (isBlank(v)) return null;
  const m = trimJa(v).match(/@([^@\s>]+)\s*$/);
  const domain = m?.[1]?.toLowerCase() ?? "";
  return domain.includes(".") ? domain : null;
}

/**
 * 単価のレンジ [下限, 上限]（万円）。単一値は下限=上限。
 * 「数値として比較（下限・上限の両方）」（指示書 3.4）のための正規化。
 * 数値が読めない（「スキル見合い」等）は null → 未入力扱いで条件スキップ。
 */
export function rateRange(input: {
  rate_min?: number | null;
  rate_max?: number | null;
  rate_num?: number | null;
  rate?: string | null;
}): [number, number] | null {
  const lo = numOrNull(input.rate_min);
  const hi = numOrNull(input.rate_max);
  if (lo != null || hi != null) return [lo ?? hi!, hi ?? lo!];
  const single = numOrNull(input.rate_num);
  if (single != null) return [single, single];
  // テキスト表記（"¥70〜90万" / "80万" 等）から拾う
  if (!isBlank(input.rate)) {
    const nums = (trimJa(input.rate).match(/\d+(?:\.\d+)?/g) ?? []).map(Number).filter((n) => Number.isFinite(n) && n > 0);
    if (nums.length >= 2) return [Math.min(nums[0], nums[1]), Math.max(nums[0], nums[1])];
    if (nums.length === 1) return [nums[0], nums[0]];
  }
  return null;
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

/** 判定に使う正規化済みの人材キー項目。CSV行・既存レコードの両方をこの形に落としてから比較する */
export type DedupeKey = {
  /** 氏名（trim済み。空なら判定不能） */
  name: string | null;
  /** 所属会社（trim済み） */
  company: string | null;
  /** 年代（trim済み・完全一致。例「30代前半（30-34歳）」） */
  ageBand: string | null;
  /** 単価 [下限, 上限]（万円） */
  rate: [number, number] | null;
  /** 最寄駅（trim済み） */
  station: string | null;
  /** 居住地（trim済み） */
  residence: string | null;
  /** 連絡先ドメイン（@より後ろ・小文字） */
  contactDomain: string | null;
  /** スキルシートのリンク（trim済み） */
  skillSheet: string | null;
};

const val = (v: unknown): string | null => (isBlank(v) ? null : trimJa(v));

/** CSV行・DBレコード共通：生の項目から DedupeKey を作る */
export function toDedupeKey(src: {
  name?: string | null;
  company?: string | null;
  age_band?: string | null;
  rate_min?: number | null;
  rate_max?: number | null;
  rate_num?: number | null;
  rate?: string | null;
  location?: string | null;
  residence?: string | null;
  contact_email?: string | null;
  skill_sheet_url?: string | null;
}): DedupeKey {
  return {
    name: val(src.name),
    company: val(src.company),
    ageBand: val(src.age_band),
    rate: rateRange(src),
    station: val(src.location),
    residence: val(src.residence),
    contactDomain: emailDomain(src.contact_email),
    skillSheet: val(src.skill_sheet_url),
  };
}

type Field = Exclude<keyof DedupeKey, "name">;

/**
 * 6つの判定条件（指示書 3.1）。番号は画面表示・指示書と対応させるので変えないこと。
 *
 * 条件6だけ所属会社・連絡先を含まないのは意図的（同じ人材が別会社経由で来た場合を
 * 検出するため）。他の条件に合わせて会社を追加しないこと。
 */
export const DUP_CONDITIONS: readonly { no: number; label: string; fields: readonly Field[] }[] = [
  { no: 1, label: "氏名 ＋ 所属会社 ＋ 年代 ＋ 単価", fields: ["company", "ageBand", "rate"] },
  { no: 2, label: "氏名 ＋ 所属会社 ＋ 最寄駅", fields: ["company", "station"] },
  { no: 3, label: "氏名 ＋ 連絡先ドメイン ＋ 年代 ＋ 単価", fields: ["contactDomain", "ageBand", "rate"] },
  { no: 4, label: "氏名 ＋ 連絡先ドメイン ＋ 最寄駅", fields: ["contactDomain", "station"] },
  { no: 5, label: "氏名 ＋ スキルシートのリンク", fields: ["skillSheet"] },
  { no: 6, label: "氏名 ＋ 年代 ＋ 居住地 ＋ 単価", fields: ["ageBand", "residence", "rate"] },
];

function fieldEq(field: Field, a: DedupeKey, b: DedupeKey): boolean {
  if (field === "rate") {
    // 下限・上限の両方が数値として一致（指示書 3.4）
    return a.rate != null && b.rate != null && a.rate[0] === b.rate[0] && a.rate[1] === b.rate[1];
  }
  const av = a[field];
  const bv = b[field];
  return av != null && bv != null && av === bv;
}

/**
 * 2つの人材キーを6条件で照合し、**成立した条件番号**を返す（空なら別人）。
 *
 * - 氏名はすべての条件の前提。どちらかの氏名が未入力なら常に不成立
 * - 条件を構成する項目が**どちらか一方でも未入力なら、その条件はスキップ**（指示書 3.3）
 */
export function matchedConditions(a: DedupeKey, b: DedupeKey): number[] {
  if (a.name == null || b.name == null || a.name !== b.name) return [];
  const hit: number[] = [];
  for (const cond of DUP_CONDITIONS) {
    // 未入力の項目を含む条件は判定しない（空欄同士の「一致」は絶対に作らない）
    if (cond.fields.some((f) => (f === "rate" ? a.rate == null || b.rate == null : a[f] == null || b[f] == null))) continue;
    if (cond.fields.every((f) => fieldEq(f, a, b))) hit.push(cond.no);
  }
  return hit;
}

/**
 * 既存レコードの補完対象フィールド（指示書 5.1）。
 * 既存側が「未入力」（isBlank）かつ CSV側に値がある項目**だけ**を埋める。
 * 入力済みの値は変更しない。role 系・システム列は対象外。
 */
export const FILL_FIELDS: readonly { key: string; label: string }[] = [
  { key: "title", label: "職種" },
  { key: "company", label: "所属会社" },
  { key: "source_company", label: "所属会社（取込元）" },
  { key: "affiliation", label: "所属区分" },
  { key: "rate", label: "単価" },
  { key: "rate_num", label: "単価（数値）" },
  { key: "avail", label: "稼働開始" },
  { key: "location", label: "最寄駅" },
  { key: "residence", label: "居住地" },
  { key: "exp", label: "経験年数" },
  { key: "remote_pref", label: "リモート希望" },
  { key: "age_band", label: "年代" },
  { key: "nationality", label: "国籍" },
  { key: "skill_level", label: "スキルレベル" },
  { key: "japanese_level", label: "日本語レベル" },
  { key: "comm", label: "コミュニケーション" },
  { key: "note", label: "メール原文" },
  { key: "detail_note", label: "人材詳細" },
  { key: "skill_sheet_url", label: "スキルシート" },
  { key: "email", label: "本人メール" },
  { key: "contact_email", label: "連絡先（窓口）" },
  { key: "source_mail_url", label: "元メールリンク" },
  { key: "source_mail_at", label: "受信日時" },
];

/** 補完プランの1項目：どの項目が「何 → 何」になるか（プレビュー表示用） */
export type FillPlanItem = { key: string; label: string; from: string; to: string };

/**
 * 既存レコードに対する補完プランを作る（指示書 5.1 / 6.2）。
 * 実際の更新もこのプランに従う（画面に出したものと同じことをする）。
 */
export function buildFillPlan(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
): FillPlanItem[] {
  const plan: FillPlanItem[] = [];
  for (const f of FILL_FIELDS) {
    const cur = existing[f.key];
    const next = incoming[f.key];
    // CSV側が未入力なら何もしない。既存に値が入っていれば変更しない。
    if (isBlank(next)) continue;
    if (!isBlank(cur)) continue;
    plan.push({
      key: f.key,
      label: f.label,
      from: cur == null || trimJa(cur) === "" ? "空欄" : trimJa(cur),
      to: trimJa(next),
    });
  }
  // スキル：既存が空配列のときだけCSVの値を入れる（入力済みの配列には触れない）
  const curSkills = Array.isArray(existing.skills) ? (existing.skills as string[]) : [];
  const nextSkills = Array.isArray(incoming.skills) ? (incoming.skills as string[]) : [];
  if (curSkills.length === 0 && nextSkills.length > 0) {
    plan.push({ key: "skills", label: "スキル", from: "空欄", to: nextSkills.join(", ") });
  }
  return plan;
}
