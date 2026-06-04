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
export async function boardGet<T = unknown>(path: string, params: Record<string, string | number> = {}): Promise<BoardResult<T>> {
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
export function asArray(body: unknown): Record<string, unknown>[] {
  if (Array.isArray(body)) return body as Record<string, unknown>[];
  const b = body as Record<string, unknown> | null;
  for (const key of ["data", "invoices", "billings", "items", "results"]) {
    if (b && Array.isArray(b[key])) return b[key] as Record<string, unknown>[];
  }
  return [];
}

export type InvoiceFetch =
  | { ok: true; rows: Record<string, unknown>[]; scanned: number; capHit: boolean; descending: boolean }
  | { ok: false; error: string; status: number };

/**
 * board /invoices をページングで取得（3req/sec 制限に配慮）。
 *   - 新しい順(invoice_date desc)を要求し、降順が効いていれば対象月を過ぎた時点で打ち切る。
 *   - 降順が効かない場合はページ上限(CAP)まで取得（古い順なら対象月は後方のため上限に注意）。
 */
export async function fetchInvoices(opts?: { period?: string }): Promise<InvoiceFetch> {
  const PER = 100, CAP = 50;
  const periodStart = opts?.period && /^\d{4}-\d{2}$/.test(opts.period) ? `${opts.period}-01` : null;
  const all: Record<string, unknown>[] = [];
  let scanned = 0, capHit = false, descending = false, detected = false, effectivePer = 0;

  for (let page = 1; page <= CAP; page++) {
    const r = await boardGet("/invoices", { page, per_page: PER, sort: "invoice_date", direction: "desc" });
    if (!r.ok) return page === 1 ? r : { ok: true, rows: all, scanned, capHit, descending };
    const rows = asArray(r.data);
    if (page === 1) effectivePer = rows.length;
    scanned += rows.length;
    all.push(...rows);

    if (!detected && rows.length >= 2) {
      const first = String(rows[0]?.invoice_date ?? ""), last = String(rows[rows.length - 1]?.invoice_date ?? "");
      descending = first >= last; detected = true;
    }
    if (rows.length === 0) break;
    if (page > 1 && effectivePer > 0 && rows.length < effectivePer) break; // 最終ページ
    if (page === CAP) { capHit = true; break; }
    // 降順が効いていれば、ページ最大(最新)日が対象月より前になった時点で以降は不要
    if (descending && periodStart) {
      const maxOnPage = rows.reduce((m, x) => { const d = String(x?.invoice_date ?? ""); return d > m ? d : m; }, "");
      if (maxOnPage && maxOnPage < periodStart) break;
    }
    await sleep(350);
  }
  return { ok: true, rows: all, scanned, capHit, descending };
}

// ---- 接続テスト（プレビューで実レスポンスの形を確認するためのデバッグ用） --------------
const CANDIDATE_PATHS = ["/invoices", "/projects"];
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

// ---- 請求レコード(/invoices) → 突合キーの抽出（board 実レスポンス準拠） -----------------
//   案件突合: project_id（内部ID）/ project_no（案件番号）の両方を候補にする。
//   請求月  : invoice_date（YYYY-MM-DD）
//   送付判定: invoice_status_name（"未請求"/"請求済" 等）+ invoice_status(1=未請求) + paid_date

/** board の案件ID（内部ID）。 */
export function billingProjectId(b: Record<string, unknown>): string | null {
  return b?.project_id != null ? String(b.project_id) : null;
}

/** board の案件番号（UI表示の番号）。 */
export function billingProjectNo(b: Record<string, unknown>): string | null {
  return b?.project_no != null ? String(b.project_no) : null;
}

/** 'YYYY-MM' を返す。invoice_date が無ければ null。 */
export function billingPeriod(b: Record<string, unknown>): string | null {
  const v = b?.invoice_date;
  if (typeof v === "string" && /^\d{4}-\d{2}/.test(v)) return v.slice(0, 7);
  return null;
}

// ---- 案件(/projects) — 自動ひもづけ用 ----------------------------------------------
export type ProjectFetch =
  | { ok: true; rows: Record<string, unknown>[]; scanned: number; capHit: boolean }
  | { ok: false; error: string; status: number };

// board /projects は件数が多くページング取得に時間がかかるため、モジュール内に短時間キャッシュ。
//   検索・自動ひもづけ・同期で繰り返し呼ばれるので、5分キャッシュで2回目以降を高速化する。
let _projectsCache: { rows: Record<string, unknown>[]; scanned: number; capHit: boolean; at: number } | null = null;
const PROJECTS_TTL_MS = 5 * 60 * 1000;

/** board /projects をページングで取得（自動ひもづけの突合元）。5分キャッシュ。force で再取得。 */
export async function fetchProjects(opts?: { force?: boolean }): Promise<ProjectFetch> {
  if (!opts?.force && _projectsCache && Date.now() - _projectsCache.at < PROJECTS_TTL_MS) {
    return { ok: true, rows: _projectsCache.rows, scanned: _projectsCache.scanned, capHit: _projectsCache.capHit };
  }
  const PER = 100, CAP = 50;
  const all: Record<string, unknown>[] = [];
  let scanned = 0, capHit = false, effectivePer = 0;
  for (let page = 1; page <= CAP; page++) {
    const r = await boardGet("/projects", { page, per_page: PER });
    if (!r.ok) return page === 1 ? r : { ok: true, rows: all, scanned, capHit };
    const rows = asArray(r.data);
    if (page === 1) effectivePer = rows.length;
    scanned += rows.length;
    all.push(...rows);
    if (rows.length === 0) break;
    if (page > 1 && effectivePer > 0 && rows.length < effectivePer) break;
    if (page === CAP) { capHit = true; break; }
    await sleep(200);
  }
  _projectsCache = { rows: all, scanned, capHit, at: Date.now() };
  return { ok: true, rows: all, scanned, capHit };
}

/** 値から表示用の文字列を取り出す。オブジェクトなら name/company_name 等のキーを再帰的に探す。 */
function toStr(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number") return String(v);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    for (const k of ["name", "company_name", "client_name", "customer_name", "title", "label"]) {
      const s = toStr(o[k]);
      if (s) return s;
    }
  }
  return null;
}

function firstStr(p: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) { const s = toStr(p?.[k]); if (s) return s; }
  return null;
}

/** 案件の内部ID。 */
export function projectId(p: Record<string, unknown>): string | null { return firstStr(p, ["id", "project_id"]); }
/** 案件番号（UI表示）。 */
export function projectNo(p: Record<string, unknown>): string | null { return firstStr(p, ["project_no", "no", "number"]); }
/** 案件名。 */
export function projectName(p: Record<string, unknown>): string | null { return firstStr(p, ["name", "project_name", "title"]); }
/** 顧客（クライアント）名。 */
export function projectClientName(p: Record<string, unknown>): string | null {
  return firstStr(p, ["client_name", "customer_name", "company_name", "client", "customer"]);
}

/** 請求額(万円換算・整数)。board は円単位なので 10000 で除して四捨五入。複数候補キーを試す。 */
export function billingAmountMan(b: Record<string, unknown>): number | null {
  for (const k of ["total_amount", "amount", "billing_amount", "total", "subtotal"]) {
    const v = b?.[k];
    const n = typeof v === "number" ? v : (typeof v === "string" ? Number(v.replace(/[^\d.-]/g, "")) : NaN);
    if (Number.isFinite(n) && n > 0) return Math.round(n / 10000);
  }
  return null;
}

/** 請求済/入金済 = true（送付完了扱い）、未請求 = false、判定不能 = null（更新しない）。 */
export function billingSent(b: Record<string, unknown>): boolean | null {
  if (b?.paid_date) return true; // 入金済なら送付済
  const name = b?.invoice_status_name != null ? String(b.invoice_status_name) : null;
  if (name) {
    if (/未請求|未送付|未発行|下書き|draft/.test(name)) return false;
    if (/請求済|送付|入金|発行済/.test(name)) return true;
  }
  const code = b?.invoice_status; // board: 1=未請求 / 2以上=請求以降
  if (typeof code === "number") return code >= 2 ? true : code === 1 ? false : null;
  return null;
}
