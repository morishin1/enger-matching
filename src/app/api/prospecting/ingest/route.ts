// エンド開拓リストへの自動追記エンドポイント。
//   用途: Claude Code の Routine（定時実行）や GitHub Actions から、その日のテーマで調べた企業を追記する。
//   保護: Authorization: Bearer ${PROSPECTING_INGEST_TOKEN}（未設定なら CRON_SECRET を使う）。どちらも無ければ 503。
//
//   GET  … 今日（JST）のテーマ・調査プロンプト・本日の追記件数を返す（Routine はこれを見て調べる）
//   POST … 調べた企業を追記する。上書きはせず新規だけ足す（社名・ドメインで重複スキップ）
//     body: { "csv": "企業名,採用ページURL,..." } もしくは
//           { "rows": [{ "企業名": "…", "企業URL": "…", "ランク": "B", "シグナル": "資金調達;複数職種募集" }] }
//           英語キー（company_name / website / career_url / industry / location / rank / signals / found_via / note）も可
//     option: source_list（出所名・既定は「日次リスト」）、owner_staff（担当）、?dry=1（登録せず件数だけ確認）
//   ※ 登録時の状態は必ず「未接触」（営業可否・営業お断りの確認は担当者が画面で行う）。
import { engerClient, dbConfigured } from "@/lib/supabase";
import { ingestProspectRows } from "@/lib/prospect-ingest";
import { dailyResearchPrompt, dailyTheme, hourlyAngle, jstDateKey, parseProspectCsv, parseSignals, PROSPECT_RANKS, RANK_PRIORITY, type ParsedProspectRow, type ProspectRank } from "@/lib/prospecting";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorize(req: Request): { ok: true } | { ok: false; status: number; error: string } {
  const secret = process.env.PROSPECTING_INGEST_TOKEN || process.env.CRON_SECRET;
  if (!secret) return { ok: false, status: 503, error: "PROSPECTING_INGEST_TOKEN 未設定" };
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${secret}`) return { ok: false, status: 401, error: "Unauthorized" };
  return { ok: true };
}

const str = (v: unknown) => {
  const s = typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
  return s ? s : null;
};

/** JSON の1件を取込行に変換。日本語キー（指示書のCSV列名）と英語キーの両方を受ける。 */
function toRow(item: Record<string, unknown>): ParsedProspectRow | null {
  const pick = (...keys: string[]) => {
    for (const k of keys) { const v = str(item[k]); if (v) return v; }
    return null;
  };
  const company_name = pick("企業名", "会社名", "company_name", "name");
  if (!company_name) return null;
  const rankRaw = (pick("ランク", "rank") ?? "").toUpperCase();
  const rank = (PROSPECT_RANKS as readonly string[]).includes(rankRaw) ? (rankRaw as ProspectRank) : null;
  const signalsRaw = item["シグナル"] ?? item["signals"];
  const signals = Array.isArray(signalsRaw) ? parseSignals(signalsRaw.join(";")) : parseSignals(str(signalsRaw));
  return {
    company_name,
    industry: pick("業種", "業界", "industry"),
    website: pick("企業URL", "URL", "website", "url"),
    career_url: pick("採用ページURL", "採用ページ", "career_url"),
    contact_form_url: pick("問い合わせフォームURL", "フォームURL", "contact_form_url"),
    phone: pick("電話", "phone"),
    contact_name: pick("担当者", "contact_name"),
    location: pick("所在地", "location"),
    rank,
    signals,
    found_via: pick("発見元", "found_via", "source"),
    owner_staff: pick("自社担当", "owner_staff"),
    source_list: pick("出所", "source_list"),
    note: pick("メモ", "note", "memo"),
    priority: rank ? RANK_PRIORITY[rank] : 50,
  };
}

export async function GET(req: Request) {
  const auth = authorize(req);
  if (!auth.ok) return Response.json({ ok: false, error: auth.error }, { status: auth.status });

  const date = jstDateKey();
  const theme = dailyTheme();
  const angle = hourlyAngle();
  const target = Number(new URL(req.url).searchParams.get("target") || "") || Number(process.env.PROSPECTING_HOURLY_TARGET ?? "10");
  let todayAdded: number | null = null;
  let recent: string[] = [];
  if (dbConfigured) {
    const sb = engerClient();
    // JST の今日 00:00 以降に入った件数（Routine が「もう十分入っているか」を判断できるように）。
    const since = new Date(`${date}T00:00:00+09:00`).toISOString();
    const res = await sb.from("prospects").select("id", { count: "exact", head: true }).gte("created_at", since);
    if (!res.error) todayAdded = res.count ?? 0;
    // 直近の登録社名。調査の段階で既存企業を避けられるようにする（無駄な検索と重複スキップを減らす）。
    const rec = await sb.from("prospects").select("company_name").order("created_at", { ascending: false }).limit(150);
    if (!rec.error) recent = (rec.data ?? []).map((r) => String((r as { company_name: string }).company_name));
  }
  return Response.json({
    ok: true, date, theme, angle, target, todayAdded, recentCompanies: recent,
    prompt: dailyResearchPrompt(theme, { date, target, angle, avoid: recent }),
  });
}

export async function POST(req: Request) {
  const auth = authorize(req);
  if (!auth.ok) return Response.json({ ok: false, error: auth.error }, { status: auth.status });

  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; }
  catch { return Response.json({ ok: false, error: "JSON body が不正です" }, { status: 400 }); }

  const dryRun = new URL(req.url).searchParams.get("dry") === "1";
  let rows: ParsedProspectRow[] = [];
  if (typeof body.csv === "string" && body.csv.trim()) {
    rows = parseProspectCsv(body.csv).rows;
  } else if (Array.isArray(body.rows)) {
    rows = (body.rows as Record<string, unknown>[]).map(toRow).filter((r): r is ParsedProspectRow => !!r);
  } else {
    return Response.json({ ok: false, error: "csv か rows のどちらかを指定してください" }, { status: 400 });
  }
  if (rows.length === 0) return Response.json({ ok: false, error: "取り込める行がありません" }, { status: 400 });
  // 1回の呼び出しで入れすぎない（毎時少量ずつ積む運用。誤爆時の被害も抑える）。
  const MAX_PER_CALL = Number(process.env.PROSPECTING_INGEST_MAX ?? "50");
  const truncated = rows.length > MAX_PER_CALL;
  if (truncated) rows = rows.slice(0, MAX_PER_CALL);

  const outcome = await ingestProspectRows(rows, {
    actor: str(body.actor) ?? "Routine",
    sourceList: str(body.source_list) ?? `日次リスト（${dailyTheme().label}）`,
    defaultOwner: str(body.owner_staff),
    dryRun,
  });
  return Response.json({ ...outcome, dryRun, parsed: rows.length, truncated, date: jstDateKey() }, { status: outcome.ok ? 200 : 500 });
}
