"use server";

import { revalidatePath } from "next/cache";
import { engerAdmin } from "@/lib/supabase";
import { callLLM, callLLMVision, parseJsonLoose } from "@/lib/llm";
import { logUsage } from "@/lib/ai-usage";

type Result = { ok: boolean; error?: string };
const BUCKET = "billing";

const ATT_SYS = "あなたは労務アシスタントです。勤怠表（CSV/画像/PDF）から当月の合計実働時間を計算します。日々の勤務時間を合計し、休憩時間は控除した『実働時間の合計』を求めてください。JSONで {hours:number(時間・小数可), days:number(出勤日数), period:'YYYY-MM'|null, note:string} のみを出力。前置き・説明は不要。";
const ATT_PROMPT = "この勤怠表から当月の合計実働時間(h)を計算してください。各日の実働を合計し、休憩は差し引きます。JSONのみで回答。";

/** 勤怠表ファイル(バイト列)からAIで合計稼働時間を算出。失敗しても請求処理は止めない（best-effort）。 */
async function computeAttendanceHours(file: File, buf: Buffer): Promise<{ hours: number | null; note?: string; error?: string }> {
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  const type = (file.type || "").toLowerCase();
  try {
    if (type.startsWith("text/") || ["csv", "txt", "tsv"].includes(ext)) {
      const text = buf.toString("utf-8").slice(0, 8000);
      const r = await callLLM({ system: ATT_SYS, prompt: `${ATT_PROMPT}\n\n${text}`, maxTokens: 300, temperature: 0.1 });
      if (!r.ok) return { hours: null, error: r.error };
      await logUsage("billing", r.model, r.usage);
      const p = parseJsonLoose<any>(r.text);
      return { hours: typeof p?.hours === "number" ? p.hours : null, note: p?.note ?? undefined };
    }
    if (type.startsWith("image/") || type === "application/pdf" || ["png", "jpg", "jpeg", "webp", "gif", "pdf"].includes(ext)) {
      const mediaType = type || (ext === "pdf" ? "application/pdf" : `image/${ext === "jpg" ? "jpeg" : ext}`);
      const r = await callLLMVision({ system: ATT_SYS, prompt: ATT_PROMPT, files: [{ mediaType, dataB64: buf.toString("base64") }], maxTokens: 400 });
      if (!r.ok) return { hours: null, error: r.error };
      await logUsage("billing", r.model, r.usage);
      const p = parseJsonLoose<any>(r.text);
      return { hours: typeof p?.hours === "number" ? p.hours : null, note: p?.note ?? undefined };
    }
    return { hours: null, note: "この形式は自動計算に未対応です（CSV/画像/PDFに対応）。時間は手入力できます。" };
  } catch (e: any) { return { hours: null, error: String(e?.message ?? e) }; }
}

/** 勤怠/請求タスクを upsert（engagement_id × period）。 */
export async function upsertBillingTask(engagementId: string, period: string, patch: Record<string, any>): Promise<Result> {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY 未設定" }; }
  if (!engagementId || !period) return { ok: false, error: "対象が不正です" };
  const allowed = ["attendance_status", "attendance_hours", "attendance_file", "invoice_status", "invoice_amount", "invoice_file", "note"];
  const row: Record<string, any> = { engagement_id: engagementId, period, updated_at: new Date().toISOString() };
  for (const k of allowed) if (k in patch) row[k] = patch[k] === "" ? null : patch[k];
  const { error } = await admin.from("billing_tasks").upsert(row, { onConflict: "engagement_id,period" });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/billing");
  return { ok: true };
}

/** ファイル(請求書/勤怠表)を Supabase Storage にアップロードしてタスクに紐付け。勤怠表はAIで稼働時間を自動算出。 */
export async function uploadBillingFile(formData: FormData): Promise<Result & { url?: string; hours?: number | null; aiNote?: string; aiError?: string }> {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY 未設定" }; }
  const engagementId = String(formData.get("engagement_id") ?? "");
  const period = String(formData.get("period") ?? "");
  const kind = String(formData.get("kind") ?? "attendance"); // attendance | invoice
  const file = formData.get("file") as File | null;
  if (!engagementId || !period || !file) return { ok: false, error: "ファイル/対象が不足しています" };

  const ext = (file.name.split(".").pop() || "dat").toLowerCase();
  const path = `${period}/${engagementId}-${kind}-${Date.now()}.${ext}`;
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    const up = await admin.storage.from(BUCKET).upload(path, buf, { contentType: file.type || "application/octet-stream", upsert: true });
    if (up.error) return { ok: false, error: `アップロード失敗：${up.error.message}（Storageに公開バケット "billing" を作成してください）` };
    const url = admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
    const field = kind === "invoice" ? "invoice_file" : "attendance_file";
    const row: Record<string, any> = { engagement_id: engagementId, period, [field]: url, updated_at: new Date().toISOString() };

    // 勤怠表 → AIで合計稼働時間を算出して自動入力（best-effort）
    let hours: number | null = null; let aiNote: string | undefined; let aiError: string | undefined;
    if (kind === "attendance") {
      const r = await computeAttendanceHours(file, buf);
      hours = r.hours; aiNote = r.note; aiError = r.error;
      if (hours != null) row.attendance_hours = hours;
    }

    await admin.from("billing_tasks").upsert(row, { onConflict: "engagement_id,period" });
    revalidatePath("/billing");
    return { ok: true, url, hours, aiNote, aiError };
  } catch (e: any) { return { ok: false, error: String(e?.message ?? e) }; }
}

/** 貼り付けたテキスト(勤怠表/請求書)からAIで金額・時間・期間を抽出。 */
export async function extractBilling(kind: "attendance" | "invoice", text: string): Promise<{ ok: boolean; data?: any; error?: string }> {
  const t = (text ?? "").slice(0, 6000);
  if (!t.trim()) return { ok: false, error: "テキストを貼り付けてください" };
  const system = kind === "invoice"
    ? "あなたは経理アシスタントです。請求書テキストから JSON で {amount(請求額・数値・円), period('YYYY-MM'), company(請求先または発行元), note} を抽出。不明な項目は null。前置き不要、JSONのみ出力。"
    : "あなたは労務アシスタントです。勤怠表テキストから JSON で {hours(当月合計稼働時間・数値), period('YYYY-MM'), note} を抽出。不明は null。前置き不要、JSONのみ出力。";
  const r = await callLLM({ system, prompt: t, maxTokens: 300, temperature: 0.1 });
  if (!r.ok) return { ok: false, error: r.error };
  await logUsage("billing", r.model, r.usage);
  const parsed = parseJsonLoose(r.text);
  if (!parsed) return { ok: false, error: "抽出結果を解釈できませんでした" };
  return { ok: true, data: parsed };
}
