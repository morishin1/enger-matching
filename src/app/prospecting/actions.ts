"use server";

import { revalidatePath } from "next/cache";
import { currentAccess } from "@/lib/accounts";
import { callLLM } from "@/lib/llm";
import { engerAdmin } from "@/lib/supabase";
import { ingestProspectRows, type IngestOutcome } from "@/lib/prospect-ingest";
import { parseProspectCsv, parseSignals, PROSPECT_RANKS, statusFromActivity, type CsvFormat, type ProspectRank, type ProspectStatus } from "@/lib/prospecting";

type Result = { ok: boolean; error?: string; text?: string };

const clean = (v: FormDataEntryValue | null) => String(v ?? "").trim();
const num = (v: FormDataEntryValue | null, fallback = 50) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : fallback;
};

async function actorName() {
  const access = await currentAccess();
  return access?.name || access?.email || "";
}

export async function addProspect(formData: FormData): Promise<Result> {
  const company_name = clean(formData.get("company_name"));
  if (!company_name) return { ok: false, error: "会社名を入力してください" };
  const actor = await actorName();
  const rank = clean(formData.get("rank"));
  const outcome = await ingestProspectRows([{
    company_name,
    industry: clean(formData.get("industry")) || null,
    website: clean(formData.get("website")) || null,
    career_url: clean(formData.get("career_url")) || null,
    contact_form_url: clean(formData.get("contact_form_url")) || null,
    phone: clean(formData.get("phone")) || null,
    contact_name: clean(formData.get("contact_name")) || null,
    location: clean(formData.get("location")) || null,
    rank: (PROSPECT_RANKS as readonly string[]).includes(rank) ? (rank as ProspectRank) : null,
    signals: parseSignals(clean(formData.get("signals")) || null),
    found_via: clean(formData.get("found_via")) || null,
    owner_staff: clean(formData.get("owner_staff")) || actor || null,
    source_list: clean(formData.get("source_list")) || "手入力",
    note: clean(formData.get("note")) || null,
    priority: num(formData.get("priority")),
  }], { actor, defaultOwner: actor || null });
  if (!outcome.ok) return { ok: false, error: outcome.error };
  revalidatePath("/prospecting");
  return { ok: true, error: outcome.added === 0 ? `${company_name} は既に登録済みです（${outcome.skippedSamples[0]?.reason ?? "重複"}）` : undefined };
}

// CSV貼り付けによる追記。毎日流し込む運用なので、結果（追加/スキップ件数）を画面に返す。
//   useActionState から呼ぶため引数は (前回の結果, FormData)。
export type ImportState = (IngestOutcome & { format?: CsvFormat; parsed?: number }) | null;

export async function importProspectsCsv(_prev: ImportState, formData: FormData): Promise<ImportState> {
  const text = String(formData.get("csv") ?? "").trim();
  if (!text) return { ...emptyOutcome(), ok: false, error: "CSVを貼り付けてください" };
  const { rows, format } = parseProspectCsv(text);
  if (rows.length === 0) {
    // 何を貼ったのかで案内を変える（「取り込める行がありません」だけでは次の行動が分からないため）。
    const looksLikePrompt = /IT人材営業|# ルール|# 出力|CSVのコードブロック|# テーマ/.test(text);
    const headerOnly = /企業名\s*,|会社名\s*,/.test(text);
    const head = text.replace(/\s+/g, " ").slice(0, 60);
    const error = looksLikePrompt
      ? `コピーされているのは調査プロンプトです。Claude が返した「回答」の CSV（コードブロック右上のコピーボタン）をコピーしてから、もう一度押してください。（貼り付けた内容の先頭：${head}…）`
      : headerOnly
        ? `見出し行だけで、企業のデータ行がありません。Claude の回答に企業が並んでいるか確認してください。（貼り付けた内容の先頭：${head}…）`
        : `取り込める行が見つかりませんでした。1行目のヘッダ（企業名,採用ページURL,企業URL,…）と列の並びをご確認ください。（貼り付けた内容の先頭：${head}…）`;
    return { ...emptyOutcome(), ok: false, error };
  }
  const actor = await actorName();
  const outcome = await ingestProspectRows(rows, {
    actor,
    sourceList: clean(formData.get("source_list")) || null,
    defaultOwner: actor || null,
  });
  revalidatePath("/prospecting");
  return { ...outcome, format, parsed: rows.length };
}

function emptyOutcome(): IngestOutcome {
  return { ok: true, added: 0, addedNames: [], skipped: 0, skippedExisting: 0, skippedCompany: 0, skippedInBatch: 0, skippedSamples: [] };
}

export async function recordProspectActivity(formData: FormData): Promise<Result> {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY 未設定" }; }
  const prospect_id = clean(formData.get("prospect_id"));
  const activity_type = clean(formData.get("activity_type")) || "架電";
  const result = clean(formData.get("result")) || null;
  const note = clean(formData.get("note")) || null;
  if (!prospect_id) return { ok: false, error: "prospect_id がありません" };
  const actor = await actorName();
  const now = new Date().toISOString();
  const { error } = await admin.from("prospect_activities").insert({ prospect_id, activity_type, result, note, actor, activity_at: now });
  if (error) return { ok: false, error: error.message };
  const nextStatus = statusFromActivity(activity_type, result ?? "");
  const update: Record<string, string | null> = { last_activity_at: now };
  if (nextStatus) update.status = nextStatus;
  const up = await admin.from("prospects").update(update).eq("id", prospect_id);
  if (up.error) return { ok: false, error: up.error.message };
  revalidatePath("/prospecting");
  return { ok: true };
}

export async function updateProspectStatus(formData: FormData): Promise<Result> {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY 未設定" }; }
  const id = clean(formData.get("prospect_id"));
  const status = clean(formData.get("status")) as ProspectStatus;
  const ng_reason = clean(formData.get("ng_reason")) || null;
  if (!id || !status) return { ok: false, error: "入力が不足しています" };
  const { error } = await admin.from("prospects").update({ status, ng_reason }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/prospecting");
  return { ok: true };
}

export async function promoteProspectToCompany(formData: FormData): Promise<Result> {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY 未設定" }; }
  const id = clean(formData.get("prospect_id"));
  if (!id) return { ok: false, error: "prospect_id がありません" };
  const { data: p, error: loadError } = await admin.from("prospects").select("*").eq("id", id).maybeSingle();
  if (loadError || !p) return { ok: false, error: loadError?.message || "見込み企業が見つかりません" };
  const prospect = p as any;
  const company = {
    name: prospect.company_name,
    industry: prospect.industry,
    // 企業マスタのステータスは「主要 / 拡大中 / 新規 / 休眠」。エンド開拓からの昇格は新規取引先。
    //   （"active" は企業一覧の色分け・フィルタに一致せず未分類バッジになるため使わない）
    status: "新規",
    owner_staff: prospect.owner_staff,
    contact_name: prospect.contact_name,
    phone: prospect.phone,
    website: prospect.website,
    note: [prospect.note, `エンド開拓から昇格（${prospect.source_list || "出所未設定"}）`].filter(Boolean).join("\n"),
  };
  const upsert = await admin.from("companies").upsert(company, { onConflict: "name" });
  if (upsert.error) return { ok: false, error: upsert.error.message };
  const now = new Date().toISOString();
  await admin.from("prospects").update({ status: "商談", promoted_company_name: prospect.company_name, promoted_at: now }).eq("id", id);
  await admin.from("prospect_activities").insert({ prospect_id: id, activity_type: "昇格", result: "その他", note: "企業管理へ昇格", actor: await actorName(), activity_at: now });
  await admin.from("meetings").insert({
    title: `${prospect.company_name} 初回商談`,
    company_name: prospect.company_name,
    meeting_date: new Date().toISOString().slice(0, 10),
    their_contact: prospect.contact_name,
    our_owner: prospect.owner_staff,
    new_or_existing: "新規",
    relation_status: "🆕新規",
    needs: "エンド開拓のアポ獲得から自動作成",
    next_action_us: "商談日時・議題を確定する",
  });
  revalidatePath("/prospecting");
  revalidatePath("/companies");
  revalidatePath("/meetings");
  return { ok: true };
}

export async function generateProspectCopy(formData: FormData): Promise<Result> {
  const company = clean(formData.get("company_name"));
  if (!company) return { ok: false, error: "会社名がありません" };
  const system = "あなたはENGERのインサイドセールス担当です。人材紹介/SES/成功報酬の訴求を、相手企業に合わせて丁寧かつ短く書きます。自動送信ではなく手動送信用の文面を作ります。誇大表現は禁止。";
  const prompt = [
    `会社名: ${company}`,
    `業界: ${clean(formData.get("industry")) || "未設定"}`,
    `URL: ${clean(formData.get("website")) || "未設定"}`,
    `メモ: ${clean(formData.get("note")) || "なし"}`,
    "出力: 1) 問い合わせフォーム文面（件名＋本文） 2) テレアポ冒頭30秒 3) よくある断りへの切り返し3つ。日本語。",
  ].join("\n");
  const res = await callLLM({ system, prompt, maxTokens: 900, temperature: 0.5 });
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, text: res.text };
}
