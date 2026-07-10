// 提案・打合せの選択肢定数。
// ※ actions.ts は "use server" のため async 関数しか export できない。
//   定数(配列)はこの通常モジュールに置き、クライアント/サーバ双方から import する。

// 提案ステージ（実業務フローに整理）。
//   承認待ち : 提案ボタン押下直後。承認者の承認が必要。承認されると「所属確認」へ遷移
//   所属確認 : 情報が届いて最初に、案件先「まだ募集中？」＋人材先「まだ営業できる？」を確認
//   提案中   : 両方OK→提案を実施し反応待ち（社外のLINE/メール活動はメモにコピペ記録）
//   確認中   : 提案後、面談化に向けて先方の意向・条件などを確認している段階
//   面談     : 双方マッチ→面談調整・実施
//   合格     : 内定（→ 稼働化で稼働管理へ）
export const PROPOSAL_STAGES = ["承認待ち", "所属確認", "提案中", "確認中", "面談", "合格"] as const;

/** DB stage を新ステージに正規化。
 *   旧名（提案済/返信待ち/提案中/返信あり/面談調整/クロージング中/面談合格）も新名へマップ。
 *   ※ 終了系（見送り/失注/稼働/稼働決定）はボード対象外なので呼び出し側で別途処理する。 */
export function normalizeStage(s: string | null | undefined): typeof PROPOSAL_STAGES[number] {
  const v = String(s ?? "").trim();
  if ((PROPOSAL_STAGES as readonly string[]).includes(v)) return v as typeof PROPOSAL_STAGES[number];
  switch (v) {
    case "提案済": case "返信待ち": case "提案中": case "返信あり": return "提案中";
    case "面談調整": case "クロージング中": return "面談";
    case "面談合格": return "合格";
    default: return "所属確認"; // 承認後の既定（提案中ではなくフロー先頭の所属確認へ）
  }
}

// 稼働化後の終端ステージ（提案ボードからは除外し、稼働管理へ移る）
export const CONVERTED_STAGE = "稼働";

export const CALLER_STATUSES = ["未架電", "電話(不在)", "電話済み", "LINE確認中", "メール確認中", "返信あり"];
export const MEETING_STATUSES = ["調整中", "日程確定", "実施済", "リスケ", "キャンセル"];
export const PROPOSERS = ["工藤", "結城", "藤本"];
export const CLOSERS = ["未割当", "寺本", "野澤", "工藤"];
export const LOST_PHASES = ["1. 接触前失注", "2. 接触後失注", "3. 提案後失注", "4. 面談後失注"];
// 連絡手段（コンタクト履歴）。「その他」を選んだ場合は自由入力欄に手段を書く運用。
//   #334②：案件側／人材側の別が分かる側つきの手段（電話・メール・LINE）。
//   #352①：側なしの「電話」「メール」「LINE」は選択肢から削除（側つきで代替できるため）。
//   ※ 過去に側なしで記録された履歴の表示は維持される（表示は保存済みプレフィクスから解析）。
export const CONTACT_CHANNELS = [
  "案件側へ電話", "人材側へ電話",
  "案件側へメール", "人材側へメール",
  "案件側へLINE", "人材側へLINE",
  "対面", "その他",
] as const;
export type ContactChannel = typeof CONTACT_CHANNELS[number];

// #334①：マッチングレコードの進捗状況（返事待ちの別・未処理）。日付は保存時に自動記録。
//   提案ボードに記録した初期値は「未処理」。
export const PROGRESS_STATUSES = ["未処理", "案件側から返事待ち", "人材側から返事待ち", "両方から返事待ち"] as const;
export type ProgressStatus = typeof PROGRESS_STATUSES[number];
export const LOST_REASONS = [
  "A1: スキル不足/アンマッチ", "A2: 単価が高すぎ", "A3: 稼働開始時期が合わない", "A4: 人材側辞退",
  "A5: 経歴/人柄が刺さらず", "A6: ブランク/キャリアアンマッチ", "A7: 人材側 勤務地NG", "A8: 人材側 他社単価が高い",
  "B1: 他社で決定済み", "B2: ポジションクローズ", "B3: 予算が低すぎ", "B4: リモート/出社条件不一致", "B5: 契約形態が合わない",
  "C1: 別商流で同人材重複", "C2: 他社が単価安", "C3: 他社が提案速い",
  "D1: 自社の提案が遅れた", "D2: ヒアリング不足", "D3: フォロー漏れ/連絡途絶", "D4: 商流ミス",
  "E1: 担当者と連絡つかず", "E2: タイミング逃した", "E3: その他", "架電できていない",
];

// 打ち合わせ記録
export const MEETING_SENTIMENTS = ["👍ポジティブ", "😐中立", "👎ネガティブ", "⚠️競合比較"];
export const MEETING_RELATIONS = ["🆕新規", "🔄再構築", "♻️継続", "📌休眠"];
export const MEETING_OWNERS = ["藤本", "森田", "中尾", "寺本", "野沢", "工藤"];
export const MEETING_COMPETITORS = ["コモレビ", "コアラ", "キャリアビート", "Ysツール", "その他競合ツール", "言及なし"];
export const MEETING_TAGS = ["インフラ案件源", "Java強い", "ロースキル単価40万帯", "メール自動化要望", "成約率可視化要望", "双方向流通可能", "上場企業", "グループ大規模", "コミュニケーション課題", "自治体案件", "未経験育成"];

// タップ選択用プリセット（営業の入力を最小化：AIを使わず素早くデータ収集）
export const MEETING_HITS = ["スピード", "単価が安い", "人材の質", "提案力", "対応の丁寧さ", "実績・事例", "柔軟な対応", "幅広い人材"];
export const MEETING_MISSES = ["単価が高い", "スピード不足", "人材が合わない", "実績不足", "条件不一致", "タイミング", "商流が深い", "決裁が通らず"];
export const MEETING_NEEDS = ["即戦力が欲しい", "増員したい", "コスト削減", "リモート対応", "特定スキル", "長期安定", "スポット/短期", "若手・育成"];
export const MEETING_NEXT_ACTIONS = ["人材を提案", "再面談を設定", "条件・見積提示", "資料送付", "定期フォロー", "社内検討待ち", "保留・様子見"];

// 提案メモのカテゴリ。連絡記録＋やり取りの方向（当社⇄案件側／当社⇄人材側）の5分類。
export const PROPOSAL_MEMO_CATEGORIES = ["連絡記録", "当社→案件側", "案件側→当社", "当社→人材側", "人材側→当社"] as const;

// 旧カテゴリ→新カテゴリの表示変換（DB移行が未適用でも正しく表示できるようコード側でも吸収）。
//   ・重要事項 / 内部メモ → 連絡記録（過去ぶんは連絡記録に集約）
//   ・クライアント対応 → 案件側→当社、人材対応 → 人材側→当社
const LEGACY_MEMO_CATEGORY: Record<string, string> = {
  "重要事項": "連絡記録",
  "内部メモ": "連絡記録",
  "クライアント対応": "案件側→当社",
  "人材対応": "人材側→当社",
};
export function normalizeMemoCategory(c: string | null | undefined): string {
  const v = (c ?? "").trim();
  return LEGACY_MEMO_CATEGORY[v] ?? v;
}

// 共有メールボックス（ITS事業部の共有Gmail）。
//   ・送信メールの「送信元」表示は常にここ（個人アドレスだと他メンバーから送信内容が見えないため）
//   ・送信時には必ず BCC でも同アドレスへコピー → 共有Gmailの受信箱に蓄積され、全員が閲覧可能
//   ・Gmail 関連URL（authuser）にもこのアドレスを使用（src/lib/gmail.ts）
export const SHARED_MAILBOX = "its@gw.8grp.co.jp";
