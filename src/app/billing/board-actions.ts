"use server";

import { revalidatePath } from "next/cache";
import { engerAdmin } from "@/lib/supabase";
import { currentAccess } from "@/lib/accounts";
import { boardConfigured, fetchBillings, probeBoard, billingProjectId, billingPeriod, billingSent, type BoardProbe } from "@/lib/board";

// ★要確認：board 請求一覧のエンドポイント。boardConnectionTest() で候補を当たって確定する。
const BILLINGS_PATH = "/invoices";

type Access = Awaited<ReturnType<typeof currentAccess>>;
function canManage(access: Access): boolean {
  const role = access?.role ?? "admin";
  const isBackoffice = (access?.functions ?? []).includes("バックオフィス");
  return role === "admin" || isBackoffice;
}

/** 稼働に board 案件ID を手動ひもづけ（管理者・バックオフィスのみ）。 */
export async function setBoardProjectId(engagementId: string, value: string): Promise<{ ok: boolean; error?: string }> {
  if (!canManage(await currentAccess())) return { ok: false, error: "権限がありません" };
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }
  if (!engagementId) return { ok: false, error: "対象が不正です" };
  const v = value.trim() || null;
  const { error } = await admin.from("engagements").update({ board_project_id: v }).eq("id", engagementId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/progress");
  return { ok: true };
}

/**
 * board の請求ステータスを読み取り、当月(period)の請求「送付状況」を更新（読み取り専用同期）。
 *   突合: engagements.board_project_id ←→ 請求レコードの案件ID
 *   反映: 請求済/送付済 → invoice_status='送付完了' / 未請求 → '未'（判定不能はスキップ）
 */
export async function syncBoardInvoices(period: string): Promise<{ ok: boolean; error?: string; matched?: number; updated?: number; period?: string }> {
  if (!canManage(await currentAccess())) return { ok: false, error: "権限がありません" };
  if (!boardConfigured()) return { ok: false, error: "BOARD_API_KEY / BOARD_API_TOKEN が未設定です（Vercel環境変数）" };
  if (!/^\d{4}-\d{2}$/.test(period)) return { ok: false, error: "対象月が不正です" };
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }

  // board 案件ID が設定済みの稼働 → 案件ID別の稼働IDリスト
  const eng = await admin.from("engagements").select("id, board_project_id").not("board_project_id", "is", null);
  if (eng.error) return { ok: false, error: `稼働取得エラー：${eng.error.message}（先に supabase/board-link.sql を実行してください）` };
  const byProject = new Map<string, string[]>();
  for (const e of eng.data ?? []) {
    const pid = String((e as { board_project_id?: unknown }).board_project_id ?? "").trim();
    if (!pid) continue;
    const arr = byProject.get(pid) ?? [];
    arr.push((e as { id: string }).id);
    byProject.set(pid, arr);
  }
  if (byProject.size === 0) return { ok: true, matched: 0, updated: 0, period };

  const bills = await fetchBillings(BILLINGS_PATH);
  if (!bills.ok) return { ok: false, error: `board 取得エラー：${bills.error}` };

  let matched = 0, updated = 0;
  for (const b of bills.data) {
    const pid = billingProjectId(b);
    if (!pid || !byProject.has(pid)) continue;
    if (billingPeriod(b) !== period) continue;
    const sent = billingSent(b);
    if (sent == null) continue; // 不明ステータスは更新しない（安全側）
    matched++;
    for (const engId of byProject.get(pid)!) {
      const { error } = await admin.from("billing_tasks").upsert(
        { engagement_id: engId, period, invoice_status: sent ? "送付完了" : "未", updated_at: new Date().toISOString() },
        { onConflict: "engagement_id,period" },
      );
      if (!error) updated++;
    }
  }

  await admin.from("app_settings").upsert(
    { key: "board_sync", value: { last_synced_at: new Date().toISOString(), period, matched, updated }, updated_at: new Date().toISOString() },
    { onConflict: "key" },
  );
  revalidatePath("/progress"); revalidatePath("/billing");
  return { ok: true, matched, updated, period };
}

/** 接続テスト：候補エンドポイントを当たって実レスポンスの形を返す（管理者・バックオフィスのみ）。 */
export async function boardConnectionTest(): Promise<{ ok: boolean; error?: string; probe?: BoardProbe }> {
  if (!canManage(await currentAccess())) return { ok: false, error: "権限がありません" };
  if (!boardConfigured()) return { ok: false, error: "BOARD_API_KEY / BOARD_API_TOKEN が未設定です（Vercel環境変数）" };
  return { ok: true, probe: await probeBoard() };
}
