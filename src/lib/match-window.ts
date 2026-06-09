// マッチング対象期間（鮮度ウィンドウ）の設定。
//   取込日(created_at)が「直近 days 日」以内の案件・人材だけをマッチング対象にする。
//   毎日ローリングで自動更新され、GAS/シート側の変更は不要。
//   データはDB・検索には残るため、マッチング画面の「期間外も表示」で再表示できる。
//   app_settings(key='match_window') に { enabled, days } を保存（管理者が編集）。

import { engerAdmin, engerClient, dbConfigured } from "./supabase";

export const MATCH_WINDOW_KEY = "match_window";
export type MatchWindow = { enabled: boolean; days: number };
export const DEFAULT_MATCH_WINDOW: MatchWindow = { enabled: true, days: 7 };

/** 設定を読み込み（未設定は既定＝有効・7日）。サーバ専用。 */
export async function loadMatchWindow(): Promise<MatchWindow> {
  if (!dbConfigured) return { ...DEFAULT_MATCH_WINDOW };
  try {
    let sb: ReturnType<typeof engerClient>;
    try { sb = engerAdmin(); } catch { sb = engerClient(); }
    const { data, error } = await sb.from("app_settings").select("value").eq("key", MATCH_WINDOW_KEY).maybeSingle();
    if (error || !data?.value) return { ...DEFAULT_MATCH_WINDOW };
    const v = data.value as Partial<MatchWindow>;
    const days = Number(v.days);
    return {
      enabled: v.enabled !== false,
      days: Number.isFinite(days) && days > 0 ? Math.min(365, Math.floor(days)) : 7,
    };
  } catch { return { ...DEFAULT_MATCH_WINDOW }; }
}

/** created_at が直近 days 日以内か。created_at 不明なら true（安全側＝除外しない）。 */
export function withinWindow(createdAt: string | null | undefined, days: number, nowMs = Date.now()): boolean {
  if (!createdAt) return true;
  const t = new Date(createdAt).getTime();
  if (!Number.isFinite(t)) return true;
  return nowMs - t <= days * 86400000;
}
