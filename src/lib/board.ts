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
  const PER = 100, CAP = 60;
  const period = opts?.period && /^\d{4}-\d{2}$/.test(opts.period) ? opts.period : null;
  const periodStart = period ? `${period}-01` : null;
  // 対象月の末日（YYYY-MM-末日）。board の invoice_date 絞り込みクエリに使う。
  const periodEnd = period ? `${period}-${String(new Date(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0).getDate()).padStart(2, "0")}` : null;

  // ① 対象月で直接フィルタを試す（board の invoice_date 範囲クエリ）。
  //    board は sort=invoice_date が効かず古い順で返るため、全件ページングは2016年から走って当月に届かない。
  //    日付範囲で絞れれば一発で対象月だけ取れる。複数のパラメータ名を試行。
  if (period) {
    const filterVariants: Record<string, string>[] = [
      { "invoice_date_from": periodStart!, "invoice_date_to": periodEnd! },
      { "invoice_date_gteq": periodStart!, "invoice_date_lteq": periodEnd! },
      { "from": periodStart!, "to": periodEnd! },
      { "invoice_date": period }, // YYYY-MM 部分一致を受ける実装もある
    ];
    for (const params of filterVariants) {
      const all: Record<string, unknown>[] = [];
      let scanned = 0, ok = true;
      for (let page = 1; page <= CAP; page++) {
        const r = await boardGet("/invoices", { page, per_page: PER, ...params });
        if (!r.ok) { ok = false; break; }
        const rows = asArray(r.data);
        scanned += rows.length;
        all.push(...rows);
        if (rows.length < PER) break;
        if (page === CAP) break;
        await sleep(250);
      }
      if (!ok) continue;
      // フィルタが効いたか検証：取得分のうち対象月が一定割合あれば採用
      const inPeriod = all.filter((b) => billingPeriod(b) === period).length;
      if (all.length > 0 && inPeriod > 0 && inPeriod >= all.length * 0.5) {
        return { ok: true, rows: all, scanned, capHit: false, descending: true };
      }
      // フィルタが無視され全期間が返ってきた場合は次の方式へ（inPeriod 少 = 効いていない）
    }
  }

  // ② フォールバック：id 降順（=新しい順）で全件ページング。対象月に届いたら以降は打ち切り。
  const all: Record<string, unknown>[] = [];
  let scanned = 0, capHit = false, effectivePer = 0, reachedOlder = false;
  for (let page = 1; page <= CAP; page++) {
    const r = await boardGet("/invoices", { page, per_page: PER, sort: "id", direction: "desc" });
    if (!r.ok) return page === 1 ? r : { ok: true, rows: all, scanned, capHit, descending: true };
    const rows = asArray(r.data);
    if (page === 1) effectivePer = rows.length;
    scanned += rows.length;
    all.push(...rows);
    if (rows.length === 0) break;
    if (page > 1 && effectivePer > 0 && rows.length < effectivePer) break; // 最終ページ
    if (page === CAP) { capHit = true; break; }
    // 対象月より古い請求が出始めたら、もう1ページだけ見て打ち切り（id順≒日付順前提）
    if (periodStart) {
      const anyOlder = rows.some((x) => { const d = billingPeriod(x); return d != null && d < periodStart.slice(0, 7); });
      if (anyOlder) { if (reachedOlder) break; reachedOlder = true; }
    }
    await sleep(250);
  }
  return { ok: true, rows: all, scanned, capHit, descending: true };
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
//             board のレスポンス形状は版により異なり、直接フィールドのほか
//             "project": { id, project_no } のネスト形式もありうるので両方拾う。
//   請求月  : invoice_date / billing_date（YYYY-MM-DD）
//   送付判定: invoice_status_name（"未請求"/"請求済" 等）/ status_name / status / paid_date

/** オブジェクトを安全に取り出すヘルパ（ネストされた project などを拾うため）。 */
function getObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** board の案件ID（内部ID）。直接 project_id・ネスト project.id 両対応。 */
export function billingProjectId(b: Record<string, unknown>): string | null {
  if (b?.project_id != null) return String(b.project_id);
  const proj = getObj(b?.project);
  if (proj) {
    if (proj.id != null) return String(proj.id);
    if (proj.project_id != null) return String(proj.project_id);
  }
  return null;
}

/** board の案件番号（UI表示の番号）。直接 / ネスト両対応。 */
export function billingProjectNo(b: Record<string, unknown>): string | null {
  if (b?.project_no != null) return String(b.project_no);
  const proj = getObj(b?.project);
  if (proj) {
    for (const k of ["project_no", "no", "number"]) {
      const v = proj[k]; if (v != null) return String(v);
    }
  }
  return null;
}

/** 'YYYY-MM' を返す。invoice_date / billing_date / issue_date を候補にする。 */
export function billingPeriod(b: Record<string, unknown>): string | null {
  for (const k of ["invoice_date", "billing_date", "issue_date", "date"]) {
    const v = b?.[k];
    if (typeof v === "string" && /^\d{4}-\d{2}/.test(v)) return v.slice(0, 7);
  }
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

/** board /projects をページングで取得（自動ひもづけの突合元）。5分キャッシュ。
 *   稼働化される案件は直近のものがほとんどなので、既定は「新しい順に最大10ページ(=1000件)」で打ち切り高速化。
 *   maxPages を増やせばさらに遡れる。force で再取得。 */
export async function fetchProjects(opts?: { force?: boolean; maxPages?: number }): Promise<ProjectFetch> {
  const CAP = Math.max(1, Math.min(50, opts?.maxPages ?? 10)); // 既定10ページ（約1000件）に短縮
  if (!opts?.force && _projectsCache && Date.now() - _projectsCache.at < PROJECTS_TTL_MS) {
    return { ok: true, rows: _projectsCache.rows, scanned: _projectsCache.scanned, capHit: _projectsCache.capHit };
  }
  const PER = 100;
  const all: Record<string, unknown>[] = [];
  let scanned = 0, capHit = false, effectivePer = 0;
  for (let page = 1; page <= CAP; page++) {
    // 新しい案件から取得（id 降順）。直近の案件が先に揃うので少ないページで足りる。
    const r = await boardGet("/projects", { page, per_page: PER, sort: "id", direction: "desc" });
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

/** 請求済/入金済 = true（送付完了扱い）、未請求 = false、判定不能 = null（更新しない）。
 *  board の version によりフィールド形が異なるので幅広く拾う:
 *    - paid_date / paid_at がある = 入金済
 *    - 名前ベース: invoice_status_name / status_name / status(文字列) / invoice_status.name
 *    - コード:    invoice_status(数値・1=未請求/2以上=請求以降)
 *    - フラグ:    sent / is_sent / sent_at（あれば送付済扱い） */
export function billingSent(b: Record<string, unknown>): boolean | null {
  if (toStr(b?.paid_date) || toStr(b?.paid_at)) return true;
  if (toStr(b?.sent_at)) return true;
  const sentFlag = b?.sent ?? b?.is_sent;
  if (sentFlag === true) return true;
  if (sentFlag === false) return false;
  // ネスト invoice_status: { name } / status: { name } も拾う
  const statusObj = getObj(b?.invoice_status) ?? getObj(b?.status);
  const name = toStr(b?.invoice_status_name) || toStr(b?.status_name)
    || (statusObj ? toStr(statusObj.name) : null)
    || (typeof b?.status === "string" ? String(b.status) : null);
  if (name) {
    if (/未請求|未送付|未発行|下書き|draft|unsent|pending/i.test(name)) return false;
    if (/請求済|送付|入金|発行済|sent|issued|paid/i.test(name)) return true;
  }
  // 数値コード（board: 1=未請求 / 2以上=請求以降）
  const code = typeof b?.invoice_status === "number" ? (b.invoice_status as number)
    : (statusObj && typeof statusObj.id === "number" ? statusObj.id as number : null);
  if (code != null) return code >= 2 ? true : code === 1 ? false : null;
  return null;
}
