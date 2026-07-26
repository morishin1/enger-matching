import { dbConfigured, engerClient } from "@/lib/supabase";

export const PROSPECT_STATUSES = ["未接触", "フォーム送信済", "架電済", "反応あり", "アポ獲得", "商談", "ENGER登録", "見送り・NG"] as const;
export type ProspectStatus = (typeof PROSPECT_STATUSES)[number];

// 日次リストのランク（A＝今週送る／B＝来週以降／C＝対象外）と、取り込みを許すシグナル。
//   シグナルはこの候補以外の語を取り込み時に落とす（表記ゆれで集計が割れるのを防ぐ）。
export const PROSPECT_RANKS = ["A", "B", "C"] as const;
export type ProspectRank = (typeof PROSPECT_RANKS)[number];
export const PROSPECT_SIGNALS = ["資金調達", "新規事業", "新拠点・増員", "DX・AI導入", "複数職種募集", "技術発信"] as const;
export const RANK_PRIORITY: Record<ProspectRank, number> = { A: 85, B: 55, C: 25 };

export type Prospect = {
  id: string;
  company_name: string;
  industry: string | null;
  website: string | null;
  contact_form_url: string | null;
  phone: string | null;
  contact_name: string | null;
  status: ProspectStatus;
  priority: number;
  owner_staff: string | null;
  ng_reason: string | null;
  note: string | null;
  source_list: string | null;
  last_activity_at: string | null;
  next_action_at: string | null;
  promoted_company_name: string | null;
  promoted_at: string | null;
  created_at: string;
  // 毎日追記（日次リスト）用の追加項目。supabase/prospecting-daily.sql 未実行の環境では undefined。
  career_url?: string | null;
  location?: string | null;
  rank?: ProspectRank | null;
  signals?: string[] | null;
  found_via?: string | null;
};

export type ProspectActivity = {
  id: string;
  prospect_id: string;
  activity_type: string;
  result: string | null;
  note: string | null;
  activity_at: string;
  actor: string | null;
};

export type ProspectingData = {
  configured: boolean;
  setupMissing: boolean;
  prospects: Prospect[];
  activities: ProspectActivity[];
  companies: { name: string; website: string | null; phone: string | null }[];
};

export function statusFromActivity(activityType: string, result: string): ProspectStatus | null {
  if (result === "アポ") return "アポ獲得";
  if (result === "NG") return "見送り・NG";
  if (activityType === "フォーム送信") return "フォーム送信済";
  if (activityType === "架電") return result === "担当接続" ? "反応あり" : "架電済";
  if (activityType === "メール") return "フォーム送信済";
  if (activityType === "反応") return "反応あり";
  return null;
}

export async function loadProspectingData(): Promise<ProspectingData> {
  if (!dbConfigured) return { configured: false, setupMissing: false, prospects: [], activities: [], companies: [] };
  const sb = engerClient();
  const pr = await sb.from("prospects").select("*").order("priority", { ascending: false }).order("created_at", { ascending: false }).limit(500);
  if (pr.error) return { configured: true, setupMissing: true, prospects: [], activities: [], companies: [] };

  const prospects = (pr.data ?? []) as Prospect[];
  const ids = prospects.map((p) => p.id);
  let activities: ProspectActivity[] = [];
  if (ids.length) {
    const ar = await sb.from("prospect_activities").select("*").in("prospect_id", ids).order("activity_at", { ascending: false }).limit(1000);
    if (!ar.error) activities = (ar.data ?? []) as ProspectActivity[];
  }

  let companies: { name: string; website: string | null; phone: string | null }[] = [];
  const cr = await sb.from("companies").select("name, website, phone").limit(20000);
  if (!cr.error) companies = (cr.data ?? []) as typeof companies;

  return { configured: true, setupMissing: false, prospects, activities, companies };
}

export function todayAttackProspects(prospects: Prospect[]): Prospect[] {
  const active = new Set<ProspectStatus>(["未接触", "フォーム送信済", "架電済", "反応あり"]);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);
  return prospects
    .filter((p) => active.has(p.status) && (!p.next_action_at || new Date(p.next_action_at).getTime() <= todayEnd.getTime()))
    .sort((a, b) => (b.priority - a.priority) || (new Date(a.last_activity_at ?? a.created_at).getTime() - new Date(b.last_activity_at ?? b.created_at).getTime()))
    .slice(0, 80);
}

// ============================================================
// 毎日追記（日次リスト）
//   運用: 画面で今日のテーマ＋調査プロンプトをコピー → 手元の Claude（Web検索）でCSVを作る
//        → 貼り付けて取込（社名・ドメインで重複スキップ）。Routine から API 追記も同じ経路。
// ============================================================

export type DailyTheme = { key: string; weekday: string; label: string; detail: string };

// 曜日テーマ（index = JST の getDay：0=日）。スキル × 地域 × シグナルの掛け算でローテーションする。
export const DAILY_THEMES: DailyTheme[] = [
  { key: "sun", weekday: "日", label: "設備系IT（POS・サイネージ・ネットワーク工事）", detail: "POS・デジタルサイネージ・ネットワーク工事などの設備系IT企業（協力会社募集を含む）。全国。" },
  { key: "mon", weekday: "月", label: "Java／Spring × 東京", detail: "Java・Spring 系のエンジニアを募集している企業。東京。" },
  { key: "tue", weekday: "火", label: "インフラ・クラウド（AWS/Azure）× 東京", detail: "インフラ・クラウド（AWS／Azure）系のエンジニアを募集している企業。東京。" },
  { key: "wed", weekday: "水", label: "SES／ビジネスパートナー募集ページのある企業（全国）", detail: "「SESパートナー募集」「ビジネスパートナー募集」ページを公開している企業。全国。" },
  { key: "thu", weekday: "木", label: "フロントエンド（React/TypeScript）× 東京・リモート可", detail: "React／TypeScript のフロントエンド人材を募集している企業。東京・リモート可。" },
  { key: "fri", weekday: "金", label: "直近3ヶ月に資金調達・新規事業を発表 × エンジニア採用中", detail: "PR TIMES 等で直近3ヶ月に資金調達・新規事業を発表し、エンジニアを採用中の企業。" },
  { key: "sat", weekday: "土", label: "PHP／モバイル（iOS・Android）× 大阪・名古屋", detail: "PHP・モバイル（iOS／Android）系のエンジニアを募集している企業。大阪・名古屋など地方都市。" },
];

/** JST の "YYYY-MM-DD"。サーバーが UTC でも日本時間の日付で数えるために使う。 */
export function jstDateKey(at: string | number | Date = new Date()): string {
  const d = at instanceof Date ? at : new Date(at);
  return d.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}

/** 今日（JST）のテーマ。 */
export function dailyTheme(at: Date = new Date()): DailyTheme {
  const dow = new Date(`${jstDateKey(at)}T00:00:00Z`).getUTCDay();
  return DAILY_THEMES[dow];
}

// 1時間ごとに自動で回す（Routine）場合、同じテーマだけだと同じ企業ばかり出て重複スキップになる。
//   時間帯で「切り口」をずらして、探索範囲を毎回変える。
export const HOURLY_ANGLES: string[] = [
  "東京23区の中小・成長企業（従業員10〜300名）",
  "首都圏（横浜・川崎・さいたま・千葉）の企業",
  "大阪・京都・神戸の企業",
  "名古屋・中部の企業",
  "福岡・九州／札幌・仙台の企業",
  "フルリモート可・地方在住可を掲げる企業",
  "直近3ヶ月に増員・採用強化・新拠点を発表した企業",
  "自社サービス／一次請けを持つ企業（多重下請けでない）",
];

/** この回（JSTの時刻）の切り口。毎時実行しても探索範囲が重ならないようにするためのもの。 */
export function hourlyAngle(at: Date = new Date()): string {
  const hour = Number((at instanceof Date ? at : new Date(at)).toLocaleString("sv-SE", { timeZone: "Asia/Tokyo" }).slice(11, 13));
  return HOURLY_ANGLES[(Number.isFinite(hour) ? hour : 0) % HOURLY_ANGLES.length];
}

/** 手元の Claude（Web検索あり）に貼るための調査プロンプト。返ってきたCSVはそのまま取込できる。 */
export function dailyResearchPrompt(theme: DailyTheme, opts: { date?: string; target?: number; angle?: string; avoid?: string[] } = {}): string {
  const date = opts.date ?? jstDateKey();
  const target = opts.target ?? 20;
  const extra: string[] = [];
  if (opts.angle) extra.push(`# この回の切り口（テーマと掛け合わせる）\n${opts.angle}`, "");
  if (opts.avoid?.length) extra.push(`# 既にリストにある企業（これらは出さない）\n${opts.avoid.slice(0, 120).join("、")}`, "");
  return [
    "あなたはIT人材営業（SES・業務委託・正社員紹介）のリサーチ担当です。",
    "株式会社エイトの営業ツール ENGER のエンドリスト（営業先企業リスト）を増やすため、",
    "Web検索で日本国内の候補企業を調査し、取り込み用CSVを作成してください。",
    "",
    `# 今日のテーマ（${date} ${theme.weekday}曜）`,
    theme.detail,
    "",
    ...extra,
    "# 調査のルール",
    "- 対象は「エンジニアを欲しがっている企業」だけ。採用ページ・求人・SES/パートナー募集などで、",
    "  今エンジニアを募集していることが確認できた企業のみ載せる（確認できない企業は出さない）",
    `- 目標${target}社。実在確認できた企業だけを載せる（URLは実際にアクセスできたものだけ。未確認の列は空欄。推測でURLを作らない）`,
    "- 問い合わせフォーム等に「営業お断り」の記載を見つけた企業は除外する",
    "- 求人媒体（Green・Wantedly等）は発見にだけ使い、必ず企業の公式サイト・採用ページのURLを載せる",
    "- 個人名・個人の連絡先は一切載せない",
    "- Web検索やページ取得が失敗する場合は、無理に埋めず、取得できた分だけ出力し、冒頭にその旨を明記する",
    "",
    "# 出力",
    "1行目にテーマと件数の要約を書き、続けてCSVを1つのコードブロックで出力する。",
    "CSVは1行1社・1行目は次のヘッダそのまま：",
    "企業名,採用ページURL,企業URL,業種,所在地,ランク,シグナル,発見元,メモ",
    "- ランク：A＝今週送る／B＝来週以降／C＝対象外",
    `- シグナル：次の候補だけを「;」区切りで（該当なしは空欄）：${PROSPECT_SIGNALS.join(";")}`,
    "- 発見元：情報を見つけた媒体名（例：PR TIMES／Green／企業HP）",
    "- メモ：提案の切り口をひと言。カンマを含む値は\"（ダブルクォート）で囲む。セル内で改行しない",
    "- 記入例：",
    "  株式会社サンプル,https://example.com/recruit,https://example.com,SaaS,東京都渋谷区,A,資金調達;複数職種募集,PR TIMES,シリーズB調達直後・エンジニア募集",
    "",
    "出力後に「dx.enger.jp/prospecting → リスト管理 → 今日の追記 に貼り付けてください（重複は自動でスキップされます）」と1行添える。",
  ].join("\n");
}

// ===== 取込CSVの解析 =====

export type ParsedProspectRow = {
  company_name: string;
  industry: string | null;
  website: string | null;
  career_url: string | null;
  contact_form_url: string | null;
  phone: string | null;
  contact_name: string | null;
  location: string | null;
  rank: ProspectRank | null;
  signals: string[];
  found_via: string | null;
  owner_staff: string | null;
  source_list: string | null;
  note: string | null;
  priority: number;
};

export type CsvFormat = "daily" | "legacy";

const emptyRow = (): ParsedProspectRow => ({
  company_name: "", industry: null, website: null, career_url: null, contact_form_url: null, phone: null,
  contact_name: null, location: null, rank: null, signals: [], found_via: null, owner_staff: null,
  source_list: null, note: null, priority: 50,
});

const cell = (v: string | undefined) => {
  const s = (v ?? "").trim();
  return s ? s : null;
};

/** 「;」区切りのシグナルを候補リストに丸める（候補外の語は落とす）。 */
export function parseSignals(raw: string | null): string[] {
  if (!raw) return [];
  const allowed = new Set<string>(PROSPECT_SIGNALS);
  return Array.from(new Set(raw.split(/[;；,、／/]/).map((s) => s.trim()).filter((s) => allowed.has(s))));
}

function parseRank(raw: string | null): ProspectRank | null {
  const v = (raw ?? "").trim().toUpperCase();
  return (PROSPECT_RANKS as readonly string[]).includes(v) ? (v as ProspectRank) : null;
}

/** 1行を区切り文字で分解（"…" 内の区切り・"" のエスケープに対応）。 */
function splitLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
    else if (ch === '"') quoted = !quoted;
    else if (ch === delimiter && !quoted) { out.push(cur.trim()); cur = ""; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/**
 * 取込CSVを解析する。2つの形式を自動判別（Excel貼り付けのタブ区切りも可）。
 *   daily : 企業名,採用ページURL,企業URL,業種,所在地,ランク,シグナル,発見元,メモ（毎日の調査結果）
 *   legacy: 会社名,業界,URL,フォームURL,電話,担当者,優先度,自社担当,出所,メモ（従来の手元リスト）
 */
export function parseProspectCsv(text: string, forced?: CsvFormat): { rows: ParsedProspectRow[]; format: CsvFormat } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return { rows: [], format: forced ?? "daily" };
  const delimiter = (lines[0].match(/\t/g)?.length ?? 0) > (lines[0].match(/,/g)?.length ?? 0) ? "\t" : ",";
  const table = lines.map((l) => splitLine(l, delimiter)).filter((cols) => cols.some(Boolean));

  const head = table[0].join(",");
  const hasHeader = /企業名|会社名/.test(table[0][0] ?? "");
  const headerIsDaily = /採用ページ|ランク|シグナル|発見元|所在地/.test(head);
  const headerIsLegacy = /業界|フォームURL|優先度|自社担当/.test(head);
  const body = hasHeader ? table.slice(1) : table;

  const format: CsvFormat =
    forced ??
    (hasHeader && headerIsDaily ? "daily"
      : hasHeader && headerIsLegacy ? "legacy"
      // ヘッダ無しは中身で推定：6列目が A/B/C なら日次、7列目が数値なら従来形式。
      : body.some((c) => parseRank(cell(c[5]))) ? "daily"
      : body.some((c) => c.length >= 7 && /^\d{1,3}$/.test((c[6] ?? "").trim())) ? "legacy"
      : "daily");

  const rows = body
    .map((c) => {
      const row = emptyRow();
      if (format === "daily") {
        row.company_name = (c[0] ?? "").trim();
        row.career_url = cell(c[1]);
        row.website = cell(c[2]);
        row.industry = cell(c[3]);
        row.location = cell(c[4]);
        row.rank = parseRank(cell(c[5]));
        row.signals = parseSignals(cell(c[6]));
        row.found_via = cell(c[7]);
        row.note = cell(c[8]);
        row.priority = row.rank ? RANK_PRIORITY[row.rank] : 50;
      } else {
        row.company_name = (c[0] ?? "").trim();
        row.industry = cell(c[1]);
        row.website = cell(c[2]);
        row.contact_form_url = cell(c[3]);
        row.phone = cell(c[4]);
        row.contact_name = cell(c[5]);
        row.priority = Number(c[6]) || 50;
        row.owner_staff = cell(c[7]);
        row.source_list = cell(c[8]);
        row.note = cell(c[9]);
      }
      return row;
    })
    .filter((r) => r.company_name && !/^(企業名|会社名)$/.test(r.company_name));

  return { rows, format };
}

// ===== 重複判定（社名・URLドメイン）=====

const CORP_WORDS = /(株式会社|有限会社|合同会社|合資会社|合名会社|一般社団法人|一般財団法人|公益社団法人|公益財団法人|\(株\)|（株）|\(有\)|（有）|㈱|㈲)/g;

/** 社名の比較キー（法人格・空白・記号を落として比較する）。 */
export function normalizedCompanyKey(name: string): string {
  return (name ?? "")
    .replace(CORP_WORDS, "")
    .replace(/[\s　]/g, "")
    .replace(/[・.,·]/g, "")
    .toLowerCase();
}

/** URL のドメイン比較キー（www・末尾スラッシュを無視）。取れなければ空文字。 */
export function urlDomainKey(url: string | null | undefined): string {
  const raw = (url ?? "").trim();
  if (!raw) return "";
  const m = raw.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split(/[/?#]/)[0];
  return m ? m.toLowerCase() : "";
}

/** 直近 days 日（JST）の追記件数。毎日ちゃんと積み上がっているかを画面で見るための集計。 */
export function dailyAddedCounts(prospects: Prospect[], days = 7): { date: string; label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const p of prospects) {
    const key = jstDateKey(p.created_at);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const today = new Date(`${jstDateKey()}T00:00:00Z`).getTime();
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(today - (days - 1 - i) * 86400000);
    const date = d.toISOString().slice(0, 10);
    return { date, label: `${d.getUTCMonth() + 1}/${d.getUTCDate()}`, count: counts.get(date) ?? 0 };
  });
}

export function prospectingMetrics(prospects: Prospect[]) {
  const total = prospects.length;
  const contacted = prospects.filter((p) => p.status !== "未接触").length;
  const appointments = prospects.filter((p) => ["アポ獲得", "商談", "ENGER登録"].includes(p.status)).length;
  const registered = prospects.filter((p) => p.status === "ENGER登録" || p.promoted_at).length;
  const byOwner = groupRate(prospects, (p) => p.owner_staff || "未設定");
  const bySource = groupRate(prospects, (p) => p.source_list || "未設定");
  return { total, contacted, appointments, registered, byOwner, bySource };
}

function groupRate(prospects: Prospect[], keyer: (p: Prospect) => string) {
  const m = new Map<string, { total: number; contacted: number; appointments: number; registered: number }>();
  for (const p of prospects) {
    const k = keyer(p);
    const row = m.get(k) ?? { total: 0, contacted: 0, appointments: 0, registered: 0 };
    row.total++;
    if (p.status !== "未接触") row.contacted++;
    if (["アポ獲得", "商談", "ENGER登録"].includes(p.status)) row.appointments++;
    if (p.status === "ENGER登録" || p.promoted_at) row.registered++;
    m.set(k, row);
  }
  return Array.from(m.entries()).map(([label, v]) => ({ label, ...v })).sort((a, b) => b.total - a.total).slice(0, 12);
}
