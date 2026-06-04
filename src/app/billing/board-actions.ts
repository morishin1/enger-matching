"use server";

import { revalidatePath } from "next/cache";
import { engerAdmin } from "@/lib/supabase";
import { currentAccess } from "@/lib/accounts";
import { boardConfigured, fetchInvoices, fetchProjects, probeBoard, billingProjectId, billingProjectNo, billingPeriod, billingSent, billingAmountMan, projectId, projectNo, projectName, projectClientName, type BoardProbe } from "@/lib/board";

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
export async function syncBoardInvoices(period: string): Promise<{ ok: boolean; error?: string; matched?: number; updated?: number; period?: string; scanned?: number; capHit?: boolean; mapped?: number }> {
  if (!canManage(await currentAccess())) return { ok: false, error: "権限がありません" };
  if (!boardConfigured()) return { ok: false, error: "BOARD_API_KEY / BOARD_API_TOKEN が未設定です（Vercel環境変数）" };
  if (!/^\d{4}-\d{2}$/.test(period)) return { ok: false, error: "対象月が不正です" };
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }

  // board 案件ID/案件番号 が設定済みの稼働 → ひもづけ値別の稼働IDリスト
  const eng = await admin.from("engagements").select("id, board_project_id").not("board_project_id", "is", null);
  if (eng.error) return { ok: false, error: `稼働取得エラー：${eng.error.message}（先に supabase/board-link.sql を実行してください）` };
  const byKey = new Map<string, string[]>();
  for (const e of eng.data ?? []) {
    const key = String((e as { board_project_id?: unknown }).board_project_id ?? "").trim();
    if (!key) continue;
    const arr = byKey.get(key) ?? [];
    arr.push((e as { id: string }).id);
    byKey.set(key, arr);
  }
  if (byKey.size === 0) return { ok: true, matched: 0, updated: 0, period, mapped: 0, scanned: 0, capHit: false };

  const inv = await fetchInvoices({ period });
  if (!inv.ok) return { ok: false, error: `board 取得エラー：${inv.error}` };

  let matched = 0, updated = 0;
  for (const b of inv.rows) {
    if (billingPeriod(b) !== period) continue;
    // 案件ID または 案件番号 のどちらでも突合（ユーザーが入力した値に合わせる）
    const pid = billingProjectId(b), pno = billingProjectNo(b);
    const engIds = (pid && byKey.get(pid)) || (pno && byKey.get(pno));
    if (!engIds) continue;
    const sent = billingSent(b);
    if (sent == null) continue; // 不明ステータスは更新しない（安全側）
    matched++;
    const amount = billingAmountMan(b);
    for (const engId of engIds) {
      const patch: Record<string, any> = { engagement_id: engId, period, invoice_status: sent ? "送付完了" : "未", updated_at: new Date().toISOString() };
      if (amount != null) patch.invoice_amount = amount;
      const { error } = await admin.from("billing_tasks").upsert(patch, { onConflict: "engagement_id,period" });
      if (!error) updated++;
    }
  }

  await admin.from("app_settings").upsert(
    { key: "board_sync", value: { last_synced_at: new Date().toISOString(), period, matched, updated, scanned: inv.scanned, capHit: inv.capHit }, updated_at: new Date().toISOString() },
    { onConflict: "key" },
  );
  revalidatePath("/progress"); revalidatePath("/billing");
  return { ok: true, matched, updated, period, mapped: byKey.size, scanned: inv.scanned, capHit: inv.capHit };
}

// ---- 自動ひもづけ ----------------------------------------------------------------
/** 企業名/案件名を比較しやすい形に正規化（株式会社などを除去、英数小文字、空白除去、長音/ハイフン/中点も正規化）。 */
function normalizeCompany(s: string): string {
  return s
    .replace(/[\s　]+/g, "")
    .replace(/[（）\(\)【】［\[\]］]/g, "")
    .replace(/(株式会社|有限会社|合同会社|合資会社|合名会社|（株）|\(株\)|（有）|\(有\)|Inc\.?|Co\.?,?\s*Ltd\.?|Corp\.?|Corporation|Limited|LLC)/gi, "")
    .replace(/[ー－−–—\-]/g, "")  // 長音・ハイフン類はすべて除去（ アドバンスト・インテリジェント vs アドバンストインテリジェント 等を吸収）
    .replace(/[・·•]/g, "")           // 中点も除去
    .toLowerCase();
}
function normalizeText(s: string): string {
  return s.replace(/[\s　]+/g, "").replace(/[ー－−–—\-]/g, "").replace(/[・·•]/g, "").toLowerCase();
}

/**
 * 自動ひもづけ：board の案件一覧を取得し、未ひもづけの稼働(board_project_id IS NULL)に対して
 *   ・企業名(client_name) が完全/部分一致 かつ
 *   ・人材名(candidate_name) または 案件名(job_title) が案件名に含まれる
 *   を満たす board 案件を割り当てる。複数候補がある場合はスキップ（安全側）。
 *
 *  マッチング戦略（順に試行・最初に成立した時点で確定）:
 *    1) 完全一致（正規化後）
 *    2) 部分一致（ENGER企業名 ⊂ board顧客名 または その逆）
 */
export async function autoLinkBoardProjects(): Promise<{ ok: boolean; error?: string; linked?: number; skipped?: number; targets?: number; projects?: number; ambiguous?: number; noClient?: number }> {
  if (!canManage(await currentAccess())) return { ok: false, error: "権限がありません" };
  if (!boardConfigured()) return { ok: false, error: "BOARD_API_KEY / BOARD_API_TOKEN が未設定です（Vercel環境変数）" };
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }

  const eng = await admin
    .from("engagements")
    .select("id, company, candidate_name, job_title, board_project_id, status")
    .is("board_project_id", null)
    .in("status", ["稼働中", "予定"]);
  if (eng.error) return { ok: false, error: `稼働取得エラー：${eng.error.message}` };
  const targets = (eng.data ?? []).filter((e: any) => e.company);
  if (targets.length === 0) return { ok: true, linked: 0, skipped: 0, targets: 0, projects: 0, ambiguous: 0, noClient: 0 };

  const pr = await fetchProjects();
  if (!pr.ok) return { ok: false, error: `board 案件取得エラー：${pr.error}` };

  // 正規化済みの企業名でグルーピング
  type P = { id: string; no: string | null; name: string; client: string; clientKey: string };
  const byClient = new Map<string, P[]>();
  const allProjects: P[] = [];
  for (const row of pr.rows) {
    const id = projectId(row); const client = projectClientName(row); const name = projectName(row);
    if (!id || !client) continue;
    const key = normalizeCompany(client);
    if (!key) continue;
    const item: P = { id, no: projectNo(row), name: name ?? "", client, clientKey: key };
    const arr = byClient.get(key) ?? [];
    arr.push(item);
    byClient.set(key, arr);
    allProjects.push(item);
  }

  /** 該当企業名から board 案件候補を取得（完全一致 → 部分一致の順に試行）。 */
  const findCandidates = (companyName: string): P[] => {
    const key = normalizeCompany(companyName);
    if (!key) return [];
    const exact = byClient.get(key);
    if (exact && exact.length > 0) return exact;
    // 部分一致：ENGER企業名⊂board顧客名 または その逆（短い文字列を含む方向にも対応）
    return allProjects.filter((p) => p.clientKey.includes(key) || key.includes(p.clientKey));
  };

  let linked = 0, skipped = 0, ambiguous = 0, noClient = 0;
  for (const e of targets) {
    const candidates = findCandidates(String(e.company));
    if (!candidates || candidates.length === 0) { noClient++; skipped++; continue; }
    // 1案件しかなければ即採用
    let chosen: P | null = null;
    if (candidates.length === 1) {
      chosen = candidates[0];
    } else {
      // 人材名 or 案件名が一致する案件を優先
      const cn = e.candidate_name ? normalizeText(String(e.candidate_name)) : "";
      const jt = e.job_title ? normalizeText(String(e.job_title)) : "";
      const hits = candidates.filter((c) => {
        const nn = normalizeText(c.name);
        return (cn && nn.includes(cn)) || (jt && nn.includes(jt));
      });
      if (hits.length === 1) chosen = hits[0];
      else { ambiguous++; skipped++; continue; } // 0件 or 複数 → 安全側でスキップ
    }
    const idVal = chosen.no ?? chosen.id;
    const upd = await admin.from("engagements").update({ board_project_id: idVal }).eq("id", e.id);
    if (!upd.error) linked++;
    else skipped++;
  }

  revalidatePath("/progress");
  return { ok: true, linked, skipped, targets: targets.length, projects: pr.rows.length, ambiguous, noClient };
}

/** 接続テスト：候補エンドポイントを当たって実レスポンスの形を返す（管理者・バックオフィスのみ）。 */
export async function boardConnectionTest(): Promise<{ ok: boolean; error?: string; probe?: BoardProbe }> {
  if (!canManage(await currentAccess())) return { ok: false, error: "権限がありません" };
  if (!boardConfigured()) return { ok: false, error: "BOARD_API_KEY / BOARD_API_TOKEN が未設定です（Vercel環境変数）" };
  return { ok: true, probe: await probeBoard() };
}
