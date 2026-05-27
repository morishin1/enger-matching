// ============================================================
// board (the-board.jp) API クライアント — サーバ専用・読み取りのみ
//   認証: ヘッダ x-api-key（アカウントのAPIキー）+ Authorization: Bearer（トークン）
//   用途: 請求一覧を取得し、ENGER の請求「送付状況」を更新する（④）。
//   docs: https://the-board.jp/helps/help_common_api/
//
//   ★要確認（実レスポンスに合わせて調整するポイント）★
//     - BILLINGS_PATH … 請求一覧のエンドポイント（下の boardConnectionTest で候補を当たれる）
//     - billingProjectId / billingPeriod / billingSent … フィールド名・ステータス値の対応
//   いずれも「判定できなければ更新しない（安全側）」で実装している。
// ============================================================

const BASE = process.env.BOARD_API_BASE ?? "https://api.the-board.jp/v1";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function boardConfigured(): boolean {
  return Boolean(process.env.BOARD_API_KEY && process.env.BOARD_API_TOKEN);
}

function authHeaders(): Record<string, string> {
  return {
    "x-api-key": process.env.BOARD_API_KEY ?? "",
    Authorization: `Bearer ${process.env.BOARD_API_TOKEN ?? ""}`,
    Accept: "application/json",
  };
}

export type BoardResult<T> =
  | { ok: true; data: T; status: number }
  | { ok: false; error: string; status: number };

/** board へ GET。429 は指数バックオフで最大3回再試行。 */
async function boardGet<T = unknown>(path: string, params: Record<string, string | number> = {}): Promise<BoardResult<T>> {
  if (!boardConfigured()) return { ok: false, error: "BOARD_API_KEY / BOARD_API_TOKEN が未設定です（Vercel環境変数）", status: 0 };
  const url = new URL(path.startsWith("http") ? path : BASE + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  for (let attempt = 0; attempt < 3; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, { headers: authHeaders(), cache: "no-store" });
    } catch (e: unknown) {
      return { ok: false, error: `通信エラー: ${e instanceof Error ? e.message : String(e)}`, status: 0 };
    }
    if (res.status === 429) { await sleep(1000 * 2 ** attempt); continue; } // レート制限
    const text = await res.text();
    let body: unknown = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    if (!res.ok) {
      const msg = typeof body === "string" ? body.slice(0, 300)
        : ((body as Record<string, unknown>)?.message ?? (body as Record<string, unknown>)?.error ?? `HTTP ${res.status}`);
      return { ok: false, error: String(msg), status: res.status };
    }
    return { ok: true, data: body as T, status: res.status };
  }
  return { ok: false, error: "レート制限により取得できませんでした（時間をおいて再試行してください）", status: 429 };
}

/** レスポンスが配列でもラップ済み({data:[]}等)でも配列に正規化。 */
function asArray(body: unknown): Record<string, unknown>[] {
  if (Array.isArray(body)) return body as Record<string, unknown>[];
  const b = body as Record<string, unknown> | null;
  for (const key of ["data", "invoices", "billings", "items", "results"]) {
    if (b && Array.isArray(b[key])) return b[key] as Record<string, unknown>[];
  }
  return [];
}

/** 請求一覧をページングで全件取得（3req/sec 制限に配慮）。 */
export async function fetchBillings(path: string): Promise<BoardResult<Record<string, unknown>[]>> {
  const all: Record<string, unknown>[] = [];
  const PER = 100;
  for (let page = 1; page <= 50; page++) {
    const r = await boardGet(path, { page, per_page: PER });
    if (!r.ok) return page === 1 ? r : { ok: true, data: all, status: 200 };
    const rows = asArray(r.data);
    all.push(...rows);
    if (rows.length < PER) break;
    await sleep(350);
  }
  return { ok: true, data: all, status: 200 };
}

// ---- 接続テスト（プレビューで実レスポンスの形を確認するためのデバッグ用） --------------
const CANDIDATE_PATHS = ["/invoices", "/billings", "/projects"];
export type BoardProbe = {
  base: string;
  results: { path: string; status: number; ok: boolean; count: number | null; sampleKeys: string[]; sample: unknown }[];
};
export async function probeBoard(): Promise<BoardProbe> {
  const results: BoardProbe["results"] = [];
  for (const p of CANDIDATE_PATHS) {
    const r = await boardGet(p, { page: 1, per_page: 1 });
    if (r.ok) {
      const arr = asArray(r.data);
      const sample = arr[0] ?? r.data;
      results.push({ path: p, status: r.status, ok: true, count: arr.length, sampleKeys: sample && typeof sample === "object" ? Object.keys(sample as object) : [], sample });
    } else {
      results.push({ path: p, status: r.status, ok: false, count: null, sampleKeys: [], sample: r.error });
    }
    await sleep(350);
  }
  return { base: BASE, results };
}

// ---- 請求レコード → 突合キーの抽出（★フィールド名は実レスポンスに合わせて要確認） --------
const PROJECT_KEYS = ["project_id", "projectId", "deal_id", "project_no"];
const DATE_KEYS = ["billing_date", "issue_date", "issued_on", "booking_date", "booked_date", "closing_date", "billed_on", "date", "created_at"];
const STATUS_KEYS = ["billing_status", "invoice_status", "status", "payment_status", "state"];

export function billingProjectId(b: Record<string, unknown>): string | null {
  for (const k of PROJECT_KEYS) if (b?.[k] != null) return String(b[k]);
  const proj = b?.project as Record<string, unknown> | undefined;
  if (proj?.id != null) return String(proj.id);
  const deal = b?.deal as Record<string, unknown> | undefined;
  if (deal?.id != null) return String(deal.id);
  return null;
}

/** 'YYYY-MM' を返す。日付フィールドが見つからなければ null。 */
export function billingPeriod(b: Record<string, unknown>): string | null {
  for (const k of DATE_KEYS) {
    const v = b?.[k];
    if (typeof v === "string" && /^\d{4}-\d{2}/.test(v)) return v.slice(0, 7);
  }
  return null;
}

/** 送付/請求済 = true、未請求 = false、判定不能 = null（更新しない）。 */
export function billingSent(b: Record<string, unknown>): boolean | null {
  let raw: unknown = null;
  for (const k of STATUS_KEYS) if (b?.[k] != null) { raw = b[k]; break; }
  if (raw == null) return null;
  const s = String(raw);
  if (/送付|請求済|発行|入金|paid|sent|issued|billed|completed?/i.test(s)) return true;
  if (/未請求|未送付|未発行|^未|draft|unbilled|unissued|pending/i.test(s)) return false;
  return null;
}
