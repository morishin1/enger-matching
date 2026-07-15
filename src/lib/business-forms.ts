// ENGER business（法人）向け入力フォームの共通定義（DX と enger-lp で同一項目を保証する“正”）。
//   ・会社情報 / 案件 / 人材 の3フォーム。DX のマッチングが読む列（enger.companies /
//     enger.company_profiles / enger.jobs / enger.candidates）と 1:1 で対応させる。
//   ・enger-lp 側は GET /api/public/form-defs でこの定義を取得してフォームを描画する
//     （項目を増減するときはここを1か所直せば両サイトに反映される）。
//   ・JSONシリアライズ可能な純データのみ（関数を含めない）。

export type BizFieldType = "text" | "textarea" | "number" | "select" | "multiselect" | "skills" | "url";
export type BizField = {
  key: string;               // 保存キー（DBカラム or API入力キー）
  label: string;             // 表示ラベル（日本語）
  type: BizFieldType;
  required?: boolean;
  placeholder?: string;
  hint?: string;             // 入力補助の説明
  options?: string[];        // select / multiselect の選択肢（value=label）
  optionLabels?: Record<string, string>; // value と表示を分けたい場合（remote_type 等）
  unit?: string;             // number の単位（万円 等）
  maxLength?: number;
};

/** リモート区分（jobs.remote_type / candidates.remote_pref 共通）。DX の表示ロジックと同じ値。 */
export const REMOTE_OPTIONS = ["full_remote", "partial_remote", "onsite"] as const;
export const REMOTE_LABELS: Record<string, string> = { full_remote: "フルリモート", partial_remote: "一部リモート", onsite: "出社" };

/** 契約種別（jobs.contract_types）。#425：業務委託の契約形態（準委任／派遣）で選ばせる。
 *   従来は業態（SES／紹介／派遣）だったが、案件登録の「契約種別」としては契約形態が正しい。
 *   値は text[] 保存でロジック分岐に使っていないため、選択肢の変更に伴う DB 移行は不要。 */
export const CONTRACT_TYPE_OPTIONS = ["準委任", "派遣"] as const;

/** 年代（candidates.age_band）。DX 人材一覧の表記に合わせる。 */
export const AGE_BAND_OPTIONS = ["20代", "30代", "40代", "50代", "60代以上"] as const;

/** 国籍（candidates.nationality）。DX の判定（classifyCandNationality）が解釈できる表記。 */
export const NATIONALITY_OPTIONS = ["日本", "外国籍", "不明"] as const;

/** ① 会社情報（enger.company_profiles ＋ enger.companies 企業管理と連動）。 */
export const COMPANY_FORM: BizField[] = [
  // #414：会社名の編集欄。案件・企業管理・自社情報の紐付けキーのため、変更時は
  //   関連レコードを一括リネームする（PUT /api/public/company-profile 側で処理）。
  { key: "company_name",  label: "会社名",              type: "text",    required: true, placeholder: "例：株式会社エンジャー", maxLength: 120, hint: "登録済みの案件・自社情報とまとめて紐づく名称です。変更すると既存の案件・自社情報も新しい社名に引き継がれます。" },
  { key: "website",       label: "会社ホームページURL", type: "url",     placeholder: "https://your-company.co.jp", hint: "URLか法人番号を入れて「AIで下書き」を押すと下の項目を自動入力できます" },
  { key: "corporate_no",  label: "法人番号（13桁）",     type: "text",    placeholder: "1234567890123", hint: "国税庁の法人番号。ホームページが無い場合はこちらでもAI下書きできます", maxLength: 13 },
  { key: "industry",      label: "業種",                type: "text",    placeholder: "例：受託開発 / SES / 自社サービス" },
  { key: "contact_name",  label: "ご担当者名",           type: "text",    placeholder: "例：山田 太郎" },
  { key: "phone",         label: "電話番号",             type: "text",    placeholder: "例：03-1234-5678" },
  { key: "mission",       label: "ミッション・事業の目的", type: "textarea", hint: "何のために事業をしているか。共感する人材が集まり、定着・活躍につながります" },
  { key: "culture",       label: "カルチャー・働き方・バリュー", type: "textarea", hint: "大切にしている価値観、チームの雰囲気、働き方（リモート可否・裁量など）" },
  { key: "ideal_persona", label: "求める人物像",         type: "textarea", hint: "スキルだけでなく、方向性・志向で合う人を言語化。マッチング精度が上がります" },
  { key: "appeal",        label: "自社の魅力・アピール",  type: "textarea", hint: "候補者に伝えたい強み（技術スタック、成長環境、待遇、実績など）" },
];

/** ② 案件（enger.jobs）。DX のマッチング（スキル・単価・リモート・国籍/年代判定）が読む列に対応。 */
export const JOB_FORM: BizField[] = [
  { key: "title",          label: "案件名",       type: "text",   required: true, placeholder: "例：ECサイト リプレイス（Next.js）", maxLength: 120 },
  { key: "role_label",     label: "募集職種",     type: "text",   placeholder: "例：バックエンドエンジニア" },
  { key: "skills",         label: "必要スキル",   type: "skills", required: true, hint: "マッチングの主軸になります。技術名で入力（例：TypeScript, AWS, React）" },
  { key: "salary_min",     label: "単価（下限）", type: "number", unit: "万円" },
  { key: "salary_max",     label: "単価（上限）", type: "number", unit: "万円" },
  { key: "remote_type",    label: "リモート区分", type: "select", options: [...REMOTE_OPTIONS], optionLabels: REMOTE_LABELS },
  { key: "contract_types", label: "契約種別",     type: "multiselect", options: [...CONTRACT_TYPE_OPTIONS] },
  { key: "work_location",  label: "勤務地",       type: "text",   placeholder: "例：東京都渋谷区（週1出社）" },
  { key: "start_date",     label: "開始希望",     type: "text",   placeholder: "例：2026/08/01", hint: "YYYY/MM/DD 形式でご入力ください（例：2026/08/01）。" },
  { key: "detail",         label: "案件詳細",     type: "textarea", hint: "業務内容・体制・必須/歓迎要件など。国籍要件・年代条件があればここに記載（DX側で自動判定されます）" },
];

/** ③ 人材（enger.candidates）。企業に見せる情報は匿名（イニシャル＋スキル＋単価）が原則のため氏名は任意。 */
export const CANDIDATE_FORM: BizField[] = [
  { key: "name",        label: "氏名（社内管理用・任意）", type: "text", hint: "未入力の場合はイニシャルで登録されます。企業への表示は常に匿名です", maxLength: 60 },
  { key: "initials",    label: "イニシャル",   type: "text",   required: true, placeholder: "例：T.Y", maxLength: 8 },
  { key: "title",       label: "職種",         type: "text",   placeholder: "例：フロントエンドエンジニア" },
  { key: "skills",      label: "スキル",       type: "skills", required: true, hint: "マッチングの主軸になります（例：React, TypeScript, AWS）" },
  { key: "rate",        label: "希望単価",     type: "text",   placeholder: "例：〜80万 / スキル見合い" },
  { key: "salary_min",  label: "単価（下限）", type: "number", unit: "万円" },
  { key: "salary_max",  label: "単価（上限）", type: "number", unit: "万円" },
  { key: "remote_pref", label: "リモート希望", type: "select", options: [...REMOTE_OPTIONS], optionLabels: REMOTE_LABELS },
  { key: "exp",         label: "経験年数",     type: "text",   placeholder: "例：5" },
  { key: "avail",       label: "稼働開始",     type: "text",   placeholder: "例：即日 / 1ヶ月後" },
  { key: "location",    label: "最寄駅",       type: "text",   placeholder: "例：渋谷" },
  { key: "age_band",    label: "年代",         type: "select", options: [...AGE_BAND_OPTIONS] },
  { key: "nationality", label: "国籍",         type: "select", options: [...NATIONALITY_OPTIONS] },
  { key: "note",        label: "備考",         type: "textarea", hint: "並行状況・商流・面談可能日など" },
];

/** enger-lp へ渡すフォーム定義一式（/api/public/form-defs のレスポンス本体）。 */
export const BUSINESS_FORM_DEFS = {
  version: 1,
  company: COMPANY_FORM,
  job: JOB_FORM,
  candidate: CANDIDATE_FORM,
} as const;
