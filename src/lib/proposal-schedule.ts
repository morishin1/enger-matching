"use server";

// 提案の予約配信：予約の作成・一覧・キャンセル（サーバアクション）。
//   マッチング画面（Ranking100View）のフローティングバー「予約配信」から呼ばれる。
//   実際の配信（提案登録＋メール送信）は proposal-schedule-run.ts（cron）が行う。

import { engerAdmin } from "./supabase";
import { currentAccess } from "./accounts";

export type SchedulePairInput = { job_no: number; candidate_no: number; score?: number | null };

export type ScheduleRow = {
  id: string;
  scheduled_at: string;
  status: string;
  pair_count: number;
  created_by: string | null;
  processed_at: string | null;
};

const MAX_PAIRS_PER_SCHEDULE = 50; // おすすめ TOP50 の全選択まで

/** 選択ペアを指定日時に予約する。予約者（ログイン中ユーザー）が提案者として記録される。 */
export async function scheduleProposalDelivery(input: {
  pairs: SchedulePairInput[];
  scheduledAt: string; // ISO8601（クライアントで Date.toISOString() したもの）
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  const me = await currentAccess();
  if (!me) return { ok: false, error: "ログインが必要です" };
  const createdBy = (me.name ?? "").trim();
  if (!createdBy) return { ok: false, error: "操作者（担当者）が未設定です。画面右上で操作者を選択してください" };

  const pairs = (input.pairs ?? [])
    .filter((p) => Number.isFinite(Number(p?.job_no)) && Number.isFinite(Number(p?.candidate_no)))
    .map((p) => ({ job_no: Number(p.job_no), candidate_no: Number(p.candidate_no), score: p.score ?? null }));
  if (pairs.length === 0) return { ok: false, error: "配信するペアが選択されていません" };
  if (pairs.length > MAX_PAIRS_PER_SCHEDULE) return { ok: false, error: `一度に予約できるのは最大 ${MAX_PAIRS_PER_SCHEDULE} 件です` };

  const at = new Date(input.scheduledAt);
  if (isNaN(at.getTime())) return { ok: false, error: "配信日時の形式が不正です" };
  if (at.getTime() < Date.now() - 60_000) return { ok: false, error: "配信日時が過去です。未来の日時を指定してください" };

  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }

  const { data, error } = await admin.from("proposal_schedules").insert({
    scheduled_at: at.toISOString(),
    status: "pending",
    pairs,
    created_by: createdBy,
    created_by_email: me.email ?? null,
  }).select("id").single();
  if (error) {
    if (/relation .*proposal_schedules.* does not exist|schema cache/i.test(error.message)) {
      return { ok: false, error: "予約テーブル未作成です。supabase/proposal-schedules.sql を SQL Editor で実行してください" };
    }
    return { ok: false, error: error.message };
  }
  return { ok: true, id: data?.id };
}

/** 今後の予約（未実行）＋直近の実行済みを新しい順に返す。 */
export async function listProposalSchedules(): Promise<{ ok: boolean; rows: ScheduleRow[]; error?: string }> {
  const me = await currentAccess();
  if (!me) return { ok: false, rows: [], error: "ログインが必要です" };
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, rows: [], error: "サーバ設定エラー" }; }
  const { data, error } = await admin.from("proposal_schedules")
    .select("id, scheduled_at, status, pairs, created_by, processed_at")
    .order("scheduled_at", { ascending: false })
    .limit(20);
  if (error) {
    if (/relation .*proposal_schedules.* does not exist|schema cache/i.test(error.message)) return { ok: true, rows: [] };
    return { ok: false, rows: [], error: error.message };
  }
  const rows: ScheduleRow[] = (data ?? []).map((r: any) => ({
    id: r.id,
    scheduled_at: r.scheduled_at,
    status: r.status,
    pair_count: Array.isArray(r.pairs) ? r.pairs.length : 0,
    created_by: r.created_by ?? null,
    processed_at: r.processed_at ?? null,
  }));
  return { ok: true, rows };
}

/** 未実行の予約をキャンセルする。 */
export async function cancelProposalSchedule(id: string): Promise<{ ok: boolean; error?: string }> {
  const me = await currentAccess();
  if (!me) return { ok: false, error: "ログインが必要です" };
  if (!id) return { ok: false, error: "id がありません" };
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー" }; }
  // pending のときだけキャンセル可（processing/done はそのまま）
  const { data, error } = await admin.from("proposal_schedules")
    .update({ status: "canceled", updated_at: new Date().toISOString() })
    .eq("id", id).eq("status", "pending")
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) return { ok: false, error: "この予約はすでに実行中または完了しています" };
  return { ok: true };
}
