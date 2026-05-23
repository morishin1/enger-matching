"use server";

import { revalidatePath } from "next/cache";
import { engerAdmin } from "@/lib/supabase";
import { callLLM } from "@/lib/llm";
import { logUsage } from "@/lib/ai-usage";

type Result = { ok: boolean; error?: string };

/** 日報を保存（著者×日付で1件）。 */
export async function saveReport(input: { author: string; report_date: string; did: string[]; self_check: Record<string, string>; good: string; problem: string; cause: string; next_action: string; mood: string; outputs: number | null; contacts: number | null; metrics: any }): Promise<Result> {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY 未設定" }; }
  if (!input.author?.trim()) return { ok: false, error: "報告者が未設定です" };
  const row = {
    author: input.author.trim(),
    report_date: input.report_date || new Date().toISOString().slice(0, 10),
    did: input.did ?? [],
    self_check: input.self_check ?? {},
    good: input.good?.trim() || null,
    problem: input.problem?.trim() || null,
    cause: input.cause?.trim() || null,
    next_action: input.next_action?.trim() || null,
    mood: input.mood || null,
    outputs: input.outputs ?? null,
    contacts: input.contacts ?? null,
    metrics: input.metrics ?? null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await admin.from("daily_reports").upsert(row, { onConflict: "author,report_date" });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/reports");
  return { ok: true };
}

/** AIから一言コーチング（任意・1日報につき1回想定）。実績＋気づきから短く。 */
export async function coachReport(id: string): Promise<{ ok: boolean; comment?: string; error?: string }> {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY 未設定" }; }
  const { data: r } = await admin.from("daily_reports").select("*").eq("id", id).maybeSingle();
  if (!r) return { ok: false, error: "日報が見つかりません" };
  const m = (r as any).metrics ?? {};
  const system = "あなたは人材紹介エージェントの温かいが鋭いマネージャーです。日報に対し、まず良い動きを1つ承認し、次に“気づき”を促す問いかけ＋具体的な次の一手の助言を1つ。合計3行以内、日本語、説教くさくしない。";
  const prompt = [
    `担当者: ${(r as any).author}`,
    `本日実績: 提案${m.proposalsToday ?? 0} / 打合せ${m.meetingsToday ?? 0} / 進行中提案${m.activeProps ?? 0} / 今週面談${m.meetingsWeek ?? 0}`,
    `主なアウトプット数: ${(r as any).outputs ?? "-"} / 顧客接点: ${(r as any).contacts ?? "-"}`,
    `やったこと: ${((r as any).did ?? []).join("、")}`,
    `自己チェック: ${JSON.stringify((r as any).self_check ?? {})}`,
    `うまくいった: ${(r as any).good ?? "（なし）"}`,
    `詰まった/課題: ${(r as any).problem ?? "（なし）"}（なぜ: ${(r as any).cause ?? "—"}）`,
    `明日の一手: ${(r as any).next_action ?? "（なし）"}`,
    `手応え: ${(r as any).mood ?? ""}`,
  ].join("\n");
  const res = await callLLM({ system, prompt, maxTokens: 220, temperature: 0.6 });
  if (!res.ok) return { ok: false, error: res.error };
  await logUsage("coach", res.model, res.usage);
  await admin.from("daily_reports").update({ ai_comment: res.text }).eq("id", id);
  revalidatePath("/reports");
  return { ok: true, comment: res.text };
}
