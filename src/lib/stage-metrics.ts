// ステージ目標ボードの「チーム週次目標」対象メトリクス（#234①）。
//   クライアント/サーバー両方から import するため、サーバー専用の import は持たないこと。
//   キーは StageTargetBoard の列キー（日本語）と一致させる。
export const STAGE_TEAM_METRICS = ["架電", "打ち合わせ", "案件の仕入れ", "面談", "合格"] as const;
export type StageTeamMetric = typeof STAGE_TEAM_METRICS[number];
