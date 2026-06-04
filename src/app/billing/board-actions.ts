"use server";

import { revalidatePath } from "next/cache";
import { engerAdmin } from "@/lib/supabase";
import { currentAccess } from "@/lib/accounts";
import { boardConfigured, boardGet, asArray, fetchInvoices, fetchProjects, probeBoard, billingProjectId, billingProjectNo, billingPeriod, billingSent, billingAmountMan, projectId, projectNo, projectName, projectClientName, type BoardProbe } from "@/lib/board";

type Access = Awaited<ReturnType<typeof currentAccess>>;
function canManage(access: Access): boolean {
  const role = access?.role ?? "admin";
  const isBackoffice = (access?.functions ?? []).includes("バックオフィス");
  return role === "admin" || isBackoffice;
}

/** 案件No（または案件ID）から board の案件を1件引く。新規追加時の自動補完に使う。
 *  高速化：まず board に番号/IDで直接クエリ → 取れなければキャッシュ済み全件から照合。 */
export async function lookupBoardProject(noOrId: string): Promise<{ ok: boolean; error?: string; project?: { id: string; no: string | null; name: string; client: string } }> {
  if (!canManage(await currentAccess())) return { ok: false, error: "権限がありません" };
  if (!boardConfigured()) return { ok: false, error: "BOARD_API_KEY / BOARD_API_TOKEN が未設定です（Vercel環境変数）" };
  const key = String(noOrId ?? "").trim();
  if (!key) return { ok: false, error: "案件Noを入力してください" };
  const toProj = (row: Record<string, unknown>) => ({ id: projectId(row) ?? key, no: projectNo(row), name: projectName(row) ?? "", client: projectClientName(row) ?? "" });

  // ① board へ直接クエリ（案件番号 / フリーワード）。全件取得を避けて高速化。
  for (const params of [{ project_no: key }, { q: key }, { keyword: key }] as Record<string, string>[]) {
    try {
      const r = await boardGet("/projects", { page: 1, per_page: 20, ...params });
      if (r.ok) {
        const rows = asArray(r.data);
        const hit = rows.find((row) => projectNo(row) === key || projectId(row) === key) ?? (rows.length === 1 ? rows[0] : null);
        if (hit) return { ok: true, project: toProj(hit) };
      }
    } catch { /* 次の方法へ */ }
  }

  // ② フォールバック：キャッシュ済み全件から照合（5分キャッシュなので2回目以降は速い）
  const pr = await fetchProjects();
  if (!pr.ok) return { ok: false, error: `board 案件取得エラー：${pr.error}` };
  for (const row of pr.rows) {
    if (projectId(row) === key || projectNo(row) === key) return { ok: true, project: toProj(row) };
  }
  return { ok: false, error: `board に案件No「${key}」が見つかりませんでした` };
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

/** 稼働 1件だけ board と同期（指定の period について）。
 *  入力した board案件No に対し即時マッチを試み、請求書送付状況を更新する。
 *  保存→同期をワンクリックで完結させるための一覧用ヘルパ。 */
export async function syncOneEngagement(engagementId: string, period: string): Promise<{ ok: boolean; error?: string; matched?: number; updated?: number; status?: string | null }> {
  if (!canManage(await currentAccess())) return { ok: false, error: "権限がありません" };
  if (!boardConfigured()) return { ok: false, error: "BOARD_API_KEY / BOARD_API_TOKEN が未設定です" };
  if (!/^\d{4}-\d{2}$/.test(period)) return { ok: false, error: "対象月が不正です" };
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー" }; }
  const eng = await admin.from("engagements").select("id, board_project_id").eq("id", engagementId).maybeSingle();
  if (eng.error || !eng.data) return { ok: false, error: "稼働が見つかりません" };
  const key = String((eng.data as any).board_project_id ?? "").trim();
  if (!key) return { ok: false, error: "board案件No が未入力です" };

  const inv = await fetchInvoices({ period });
  if (!inv.ok) return { ok: false, error: `board 取得エラー：${inv.error}` };

  // 複数請求書があっても「1件でも請求済なら送付完了」に集約
  let matched = 0; let anySent = false; let amount: number | null = null;
  for (const b of inv.rows) {
    if (billingPeriod(b) !== period) continue;
    const pid = billingProjectId(b), pno = billingProjectNo(b);
    if (pid !== key && pno !== key) continue;
    const sent = billingSent(b);
    if (sent == null) continue;
    matched++;
    if (sent) { anySent = true; amount = billingAmountMan(b) ?? amount; }
    else if (amount == null) amount = billingAmountMan(b);
  }
  if (matched === 0) { revalidatePath("/progress"); return { ok: true, matched: 0, updated: 0, status: null }; }
  const patch: Record<string, any> = { engagement_id: engagementId, period, invoice_status: anySent ? "送付完了" : "未", updated_at: new Date().toISOString() };
  if (amount != null) patch.invoice_amount = amount;
  const { error } = await admin.from("billing_tasks").upsert(patch, { onConflict: "engagement_id,period" });
  revalidatePath("/progress"); revalidatePath("/billing");
  return { ok: error ? false : true, error: error?.message, matched, updated: error ? 0 : 1, status: anySent ? "送付完了" : "未" };
}

/**
 * board の請求ステータスを読み取り、当月(period)の請求「送付状況」を更新（読み取り専用同期）。
 *   突合: engagements.board_project_id ←→ 請求レコードの案件ID
 *   反映: 請求済/送付済 → invoice_status='送付完了' / 未請求 → '未'（判定不能はスキップ）
 */
export async function syncBoardInvoices(period: string): Promise<{ ok: boolean; error?: string; matched?: number; updated?: number; period?: string; scanned?: number; capHit?: boolean; mapped?: number; inPeriod?: number; keyMatched?: number; unknownStatus?: number }> {
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
  // 診断カウンタ：なぜ更新されないのかを見える化
  let inPeriod = 0;     // 当月の請求件数
  let keyMatched = 0;   // 紐付け済み案件にマッチした件数
  let unknownStatus = 0; // ステータス不明でスキップ

  // 稼働(engagement)ごとに「送付済か」を集約する。
  //   1案件に複数の請求書（請求済＋未請求の下書き等）がある場合、
  //   1件でも「請求済/送付済」があれば送付完了とみなす（後勝ち上書きでの取りこぼし防止）。
  const agg = new Map<string, { sent: boolean; amount: number | null }>();
  for (const b of inv.rows) {
    if (billingPeriod(b) !== period) continue;
    inPeriod++;
    const pid = billingProjectId(b), pno = billingProjectNo(b);
    const engIds = (pid && byKey.get(pid)) || (pno && byKey.get(pno));
    if (!engIds) continue;
    keyMatched++;
    const sent = billingSent(b);
    if (sent == null) { unknownStatus++; continue; }
    matched++;
    const amount = billingAmountMan(b);
    for (const engId of engIds) {
      const prev = agg.get(engId);
      agg.set(engId, {
        sent: (prev?.sent ?? false) || sent,                 // 1件でも送付済なら送付済
        amount: sent ? (amount ?? prev?.amount ?? null) : (prev?.amount ?? amount ?? null), // 送付済の金額を優先
      });
    }
  }

  // 集約結果を billing_tasks に1稼働1行で書き込む
  for (const [engId, v] of agg) {
    const patch: Record<string, any> = { engagement_id: engId, period, invoice_status: v.sent ? "送付完了" : "未", updated_at: new Date().toISOString() };
    if (v.amount != null) patch.invoice_amount = v.amount;
    const { error } = await admin.from("billing_tasks").upsert(patch, { onConflict: "engagement_id,period" });
    if (!error) updated++;
  }

  await admin.from("app_settings").upsert(
    { key: "board_sync", value: { last_synced_at: new Date().toISOString(), period, matched, updated, scanned: inv.scanned, capHit: inv.capHit }, updated_at: new Date().toISOString() },
    { onConflict: "key" },
  );
  revalidatePath("/progress"); revalidatePath("/billing");
  return { ok: true, matched, updated, period, mapped: byKey.size, scanned: inv.scanned, capHit: inv.capHit, inPeriod, keyMatched, unknownStatus };
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
export async function autoLinkBoardProjects(): Promise<{ ok: boolean; error?: string; linked?: number; skipped?: number; targets?: number; projects?: number; ambiguous?: number; noClient?: number; renamed?: number }> {
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

  // 自動ひもづけは網羅性重視で多めに遡る（最大50ページ）。検索(lookup)は直近10ページ＋番号直クエリで高速。
  const pr = await fetchProjects({ maxPages: 50 });
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

  let linked = 0, skipped = 0, ambiguous = 0, noClient = 0, renamed = 0;
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
    // 案件Noを紐付け。会社名が board と異なる場合は board の顧客名に強制統一する
    //   （表記揺れを board 側に寄せて、以降の突合・表示を一貫させる）。
    const patch: Record<string, any> = { board_project_id: idVal };
    if (chosen.client && normalizeCompany(chosen.client) !== normalizeCompany(String(e.company))) {
      patch.company = chosen.client;
    }
    const upd = await admin.from("engagements").update(patch).eq("id", e.id);
    if (!upd.error) { linked++; if (patch.company) renamed++; }
    else skipped++;
  }

  revalidatePath("/progress");
  return { ok: true, linked, skipped, targets: targets.length, projects: pr.rows.length, ambiguous, noClient, renamed };
}

/** 接続テスト：候補エンドポイントを当たって実レスポンスの形を返す（管理者・バックオフィスのみ）。 */
export async function boardConnectionTest(): Promise<{ ok: boolean; error?: string; probe?: BoardProbe }> {
  if (!canManage(await currentAccess())) return { ok: false, error: "権限がありません" };
  if (!boardConfigured()) return { ok: false, error: "BOARD_API_KEY / BOARD_API_TOKEN が未設定です（Vercel環境変数）" };
  return { ok: true, probe: await probeBoard() };
}

/** 請求レコードの生データ診断：先頭数件のフィールド名・抽出結果を返す（フィールド名特定用）。 */
export async function boardInvoiceDebug(): Promise<{ ok: boolean; error?: string; sample?: any[]; keys?: string[] }> {
  if (!canManage(await currentAccess())) return { ok: false, error: "権限がありません" };
  if (!boardConfigured()) return { ok: false, error: "BOARD_API_KEY / BOARD_API_TOKEN が未設定です" };
  const r = await boardGet("/invoices", { page: 1, per_page: 5, sort: "invoice_date", direction: "desc" });
  if (!r.ok) return { ok: false, error: `board 取得エラー：${r.error}` };
  const rows = asArray(r.data);
  if (rows.length === 0) return { ok: true, sample: [], keys: [] };
  // 各行の「ENGER が抽出した値」と「生キー一覧」を返す
  const sample = rows.map((b) => ({
    keys: Object.keys(b),
    extracted: {
      period: billingPeriod(b),
      projectId: billingProjectId(b),
      projectNo: billingProjectNo(b),
      sent: billingSent(b),
      amountMan: billingAmountMan(b),
    },
    // 日付・案件・ステータス系のキーだけ生値を抜粋（個人情報を避けつつ構造把握）
    raw: Object.fromEntries(Object.entries(b).filter(([k]) =>
      /date|project|status|no|number|amount|total|paid|sent|issue|client|customer/i.test(k))),
  }));
  return { ok: true, sample, keys: Object.keys(rows[0]) };
}
