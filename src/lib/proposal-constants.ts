// 提案・打合せの選択肢定数。
// ※ actions.ts は "use server" のため async 関数しか export できない。
//   定数(配列)はこの通常モジュールに置き、クライアント/サーバ双方から import する。

// 提案ステージ（実業務フローに整理）。
//   承認待ち : 提案ボタン押下直後。承認者の承認が必要。承認されると「所属確認」へ遷移
//   所属確認 : 情報が届いて最初に、案件先「まだ募集中？」＋人材先「まだ営業できる？」を確認
//   提案中   : 両方OK→提案を実施し反応待ち（社外のLINE/メール活動はメモにコピペ記録）
//   面談     : 双方マッチ→面談調整・実施
//   合格     : 内定（→ 稼働化で稼働管理へ）
export const PROPOSAL_STAGES = ["承認待ち", "所属確認", "提案中", "面談", "合格"] as const;

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
export const LOST_PHASES = ["1. 接触前失注", "2. 接触後失注", "3. 提案後失注", "4. 面談後失注", "5. 最終提示後失注"];
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

// 提案メモのカテゴリ。連絡記録/重要事項/内部メモ/クライアント対応/人材対応 の5分類。
export const PROPOSAL_MEMO_CATEGORIES = ["連絡記録", "重要事項", "内部メモ", "クライアント対応", "人材対応"] as const;

// 共有メールボックス（ITS事業部の共有Gmail）。
//   ・送信メールの「送信元」表示は常にここ（個人アドレスだと他メンバーから送信内容が見えないため）
//   ・送信時には必ず BCC でも同アドレスへコピー → 共有Gmailの受信箱に蓄積され、全員が閲覧可能
//   ・Gmail 関連URL（authuser）にもこのアドレスを使用（src/lib/gmail.ts）
export const SHARED_MAILBOX = "its@gw.8grp.co.jp";
