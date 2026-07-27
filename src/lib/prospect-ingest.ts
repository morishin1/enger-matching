// エンド開拓リストへの「追記」共通処理。
//   画面のCSV貼り付け（server action）と、Routine/cron から叩く API（/api/prospecting/ingest）で共用する。
//   毎日流し込む前提なので、上書きはせず「新規だけ足す」（append-only）:
//     ・社名（法人格・空白を無視）と URL ドメインで、既存リスト・企業マスタ・同一バッチ内の重複をスキップ
//     ・DB 側も normalized_name の一意制約で二重登録を止める（ON CONFLICT DO NOTHING）
//   サーバー専用（service role キーを使う）。
import { engerAdmin } from "@/lib/supabase";
import { isTemplateProspectRow, normalizedCompanyKey, urlDomainKey, type ParsedProspectRow } from "@/lib/prospecting";

export type SkipReason = "既存リスト" | "既存企業" | "重複行";

export type IngestOutcome = {
  ok: boolean;
  error?: string;
  warning?: string;
  added: number;
  addedNames: string[];
  skipped: number;
  skippedExisting: number;
  skippedCompany: number;
  skippedInBatch: number;
  skippedSamples: { name: string; reason: SkipReason }[];
};

const empty = (): IngestOutcome => ({
  ok: true, added: 0, addedNames: [], skipped: 0, skippedExisting: 0, skippedCompany: 0, skippedInBatch: 0, skippedSamples: [],
});

// 日次カラム（supabase/prospecting-daily.sql）が未適用の環境ではこれらを落として再試行する。
const DAILY_COLUMNS = ["career_url", "location", "rank", "signals", "found_via"] as const;
const isMissingColumn = (message: string) => /column .* does not exist|Could not find the .* column|schema cache/i.test(message);

type InsertRow = Record<string, unknown>;

export async function ingestProspectRows(
  rows: ParsedProspectRow[],
  opts: { actor?: string | null; sourceList?: string | null; defaultOwner?: string | null; dryRun?: boolean } = {},
): Promise<IngestOutcome> {
  const out = empty();
  if (rows.length === 0) return { ...out, ok: false, error: "取り込める行がありません" };

  // 調査プロンプトを丸ごと貼ってしまったケース：中に書いてある書式の見本
  //   （株式会社サンプル／example.com）を実在企業として登録しない。
  const templateCount = rows.filter(isTemplateProspectRow).length;
  rows = rows.filter((r) => !isTemplateProspectRow(r));
  if (rows.length === 0) {
    return {
      ...out, ok: false,
      error: "書式の見本（株式会社サンプル）しか見つかりませんでした。コピーしたのは調査プロンプトのようです。Claude の「回答」の方をコピーして貼り付けてください。",
    };
  }
  if (templateCount > 0) out.warning = `書式の見本（株式会社サンプル）の${templateCount}行は取り込みませんでした。`;

  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ...out, ok: false, error: "SUPABASE_SERVICE_ROLE_KEY 未設定" }; }

  // 既存リスト・企業マスタの社名／ドメインを引いて突き合わせる。
  const existing = await admin.from("prospects").select("company_name, website").limit(20000);
  if (existing.error) return { ...out, ok: false, error: existing.error.message };
  const companies = await admin.from("companies").select("name, website").limit(20000);

  const listNames = new Set<string>();
  const listDomains = new Set<string>();
  for (const p of existing.data ?? []) {
    listNames.add(normalizedCompanyKey(String((p as { company_name: string }).company_name ?? "")));
    const d = urlDomainKey((p as { website: string | null }).website);
    if (d) listDomains.add(d);
  }
  const companyNames = new Set<string>();
  const companyDomains = new Set<string>();
  for (const c of companies.data ?? []) {
    companyNames.add(normalizedCompanyKey(String((c as { name: string }).name ?? "")));
    const d = urlDomainKey((c as { website: string | null }).website);
    if (d) companyDomains.add(d);
  }

  const batchNames = new Set<string>();
  const batchDomains = new Set<string>();
  const toInsert: InsertRow[] = [];

  const skip = (name: string, reason: SkipReason) => {
    out.skipped++;
    if (reason === "既存リスト") out.skippedExisting++;
    else if (reason === "既存企業") out.skippedCompany++;
    else out.skippedInBatch++;
    if (out.skippedSamples.length < 20) out.skippedSamples.push({ name, reason });
  };

  for (const row of rows) {
    const nameKey = normalizedCompanyKey(row.company_name);
    if (!nameKey) continue;
    // 企業URL・採用ページURLのどちらかのドメインが一致すれば同じ会社とみなす。
    const domains = [urlDomainKey(row.website), urlDomainKey(row.career_url)].filter(Boolean);
    if (batchNames.has(nameKey) || domains.some((d) => batchDomains.has(d))) { skip(row.company_name, "重複行"); continue; }
    if (listNames.has(nameKey) || domains.some((d) => listDomains.has(d))) { skip(row.company_name, "既存リスト"); continue; }
    if (companyNames.has(nameKey) || domains.some((d) => companyDomains.has(d))) { skip(row.company_name, "既存企業"); continue; }

    batchNames.add(nameKey);
    domains.forEach((d) => batchDomains.add(d));
    toInsert.push({
      company_name: row.company_name,
      industry: row.industry,
      website: row.website,
      career_url: row.career_url,
      contact_form_url: row.contact_form_url,
      phone: row.phone,
      contact_name: row.contact_name,
      location: row.location,
      rank: row.rank,
      signals: row.signals,
      found_via: row.found_via,
      priority: row.priority,
      owner_staff: row.owner_staff || opts.defaultOwner || null,
      source_list: row.source_list || opts.sourceList || "日次リスト",
      note: row.note,
      created_by: opts.actor || null,
    });
  }

  if (toInsert.length === 0) return out;
  // 事前確認（?dry=1）：登録はせず、何件が新規で何件が重複かだけ返す。
  if (opts.dryRun) {
    out.added = toInsert.length;
    out.addedNames = toInsert.slice(0, 50).map((r) => String(r.company_name));
    return out;
  }

  // 上書きしない追記（ON CONFLICT DO NOTHING）。実際に入った行だけ返るので、それを追加件数にする。
  const insertChunk = async (chunk: InsertRow[], stripDaily: boolean) => {
    const payload = stripDaily ? chunk.map((r) => { const c = { ...r }; for (const k of DAILY_COLUMNS) delete c[k]; return c; }) : chunk;
    return admin.from("prospects").upsert(payload, { onConflict: "normalized_name", ignoreDuplicates: true }).select("company_name");
  };

  let stripDaily = false;
  for (let i = 0; i < toInsert.length; i += 500) {
    const chunk = toInsert.slice(i, i + 500);
    let res = await insertChunk(chunk, stripDaily);
    if (res.error && !stripDaily && isMissingColumn(res.error.message)) {
      // 日次カラム未適用の環境：基本項目だけで登録し、SQLの実行を促す。
      stripDaily = true;
      const note = "採用ページURL・所在地・ランク・シグナル・発見元は保存できませんでした。Supabase SQL Editor で supabase/prospecting-daily.sql を実行してください。";
      out.warning = out.warning ? `${out.warning} ${note}` : note;
      res = await insertChunk(chunk, true);
    }
    if (res.error) return { ...out, ok: false, error: res.error.message };
    const inserted = (res.data ?? []) as { company_name: string }[];
    out.added += inserted.length;
    for (const r of inserted) if (out.addedNames.length < 50) out.addedNames.push(r.company_name);
    // DB 側の一意制約で弾かれた分（同時実行・表記ゆれ）も既存扱いで数える。
    const droppedByDb = chunk.length - inserted.length;
    if (droppedByDb > 0) { out.skipped += droppedByDb; out.skippedExisting += droppedByDb; }
  }

  return out;
}
