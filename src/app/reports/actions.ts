"use server";

import { revalidatePath } from "next/cache";
import { engerAdmin } from "@/lib/supabase";
import { callLLM } from "@/lib/llm";
import { logUsage } from "@/lib/ai-usage";
import { currentAccess } from "@/lib/accounts";

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

/** 管理者：本人の週次/月次の日報を集計し、AIで講評してお知らせ送信。 */
export async function sendReportFeedback(author: string, period: "week" | "month"): Promise<{ ok: boolean; error?: string; comment?: string }> {
  const access = await currentAccess();
  if (access && access.role !== "admin") return { ok: false, error: "管理者のみ実行できます" };
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY 未設定" }; }
  if (!author) return { ok: false, error: "対象者が未指定です" };

  const days = period === "month" ? 30 : 7;
  const from = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const { data } = await admin.from("daily_reports").select("*").eq("author", author).gte("report_date", from).order("report_date", { ascending: false });
  const rows = (data ?? []) as any[];
  if (rows.length === 0) return { ok: false, error: `${author}さんの直近${days}日の日報がありません` };

  // 集計
  const cnt = rows.length;
  const moods = rows.map((r) => r.mood).filter(Boolean);
  const checkAgg: Record<string, { o: number; t: number; x: number }> = {};
  for (const r of rows) { const sc = r.self_check ?? {}; for (const k of Object.keys(sc)) { checkAgg[k] ??= { o: 0, t: 0, x: 0 }; const v = sc[k]; if (v === "○") checkAgg[k].o++; else if (v === "△") checkAgg[k].t++; else if (v === "×") checkAgg[k].x++; } }
  const problems = rows.map((r) => r.problem).filter(Boolean).slice(0, 8);
  const goods = rows.map((r) => r.good).filter(Boolean).slice(0, 5);
  const outputs = rows.reduce((s, r) => s + (Number(r.outputs) || 0), 0);
  const contacts = rows.reduce((s, r) => s + (Number(r.contacts) || 0), 0);

  const CHECK_LABEL: Record<string, string> = { goal: "目標意識", value: "価値提供", progress: "前進", speed: "スピード", promise: "期限遵守" };
  const checkLines = Object.entries(checkAgg).map(([k, v]) => `${CHECK_LABEL[k] ?? k}：○${v.o}/△${v.t}/×${v.x}`).join("、");

  const system = "あなたは温かく信頼されるマネージャーです。メンバーの一定期間の日報集計から、フィードバックを書きます。構成：①まず良い点・成長を具体的に承認、②データから見える傾向・課題を1〜2点（自己チェックの×が多い観点や繰り返す課題）、③次期間に意識してほしいこと1つ。日本語、敬意を持って、5〜7行、説教くさくしない。";
  const prompt = [
    `対象: ${author} さん / 期間: 直近${days}日 / 提出 ${cnt}回`,
    `主なアウトプット計 ${outputs} / 接点計 ${contacts}`,
    `自己チェック傾向: ${checkLines || "（データなし）"}`,
    `手応え: ${moods.join("、") || "—"}`,
    `うまくいった例: ${goods.join(" / ") || "—"}`,
    `繰り返し挙がった課題: ${problems.join(" / ") || "—"}`,
  ].join("\n");

  const res = await callLLM({ system, prompt, maxTokens: 420, temperature: 0.6 });
  if (!res.ok) return { ok: false, error: res.error };
  await logUsage("review", res.model, res.usage);

  const title = `${period === "month" ? "月次" : "週次"}フィードバック（${new Date().toISOString().slice(0, 10)}）`;
  const { error } = await admin.from("notifications").insert({ recipient: author, title, body: res.text, kind: "feedback" });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/reports"); revalidatePath("/notifications");
  return { ok: true, comment: res.text };
}

/** 管理者：日報1件に対する個別メッセージのAI下書きを生成（保存はしない、本文のみ返却）。 */
export async function draftReportMessage(reportId: string): Promise<{ ok: boolean; text?: string; error?: string }> {
  const access = await currentAccess();
  if (access && access.role !== "admin") return { ok: false, error: "管理者のみ実行できます" };
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY 未設定" }; }
  const { data: r } = await admin.from("daily_reports").select("*").eq("id", reportId).maybeSingle();
  if (!r) return { ok: false, error: "日報が見つかりません" };
  const system = "あなたはメンバーを温かく支えるマネージャーです。日報1件に対する個別メッセージを短く書きます。①頑張りや工夫を1つ具体的に承認、②次の一歩のヒント／問いかけを1つ。日本語、3〜5行、敬意を持って、説教くさくしない。";
  const prompt = [
    `担当者: ${(r as any).author}`,
    `日付: ${(r as any).report_date}`,
    `やったこと: ${((r as any).did ?? []).join("、")}`,
    `自己チェック: ${JSON.stringify((r as any).self_check ?? {})}`,
    `うまくいった: ${(r as any).good ?? "（なし）"}`,
    `詰まった/課題: ${(r as any).problem ?? "（なし）"}（なぜ: ${(r as any).cause ?? "—"}）`,
    `明日の一手: ${(r as any).next_action ?? "（なし）"}`,
    `手応え: ${(r as any).mood ?? ""}`,
  ].join("\n");
  const res = await callLLM({ system, prompt, maxTokens: 220, temperature: 0.6 });
  if (!res.ok) return { ok: false, error: res.error };
  await logUsage("report_message_draft", res.model, res.usage);
  return { ok: true, text: res.text };
}

/** 管理者：日報1件に対する個別メッセージを送信（notifications にレコード追加）。 */
export async function sendReportMessage(reportId: string, message: string): Promise<Result> {
  const access = await currentAccess();
  if (access && access.role !== "admin") return { ok: false, error: "管理者のみ実行できます" };
  if (!message?.trim()) return { ok: false, error: "メッセージが空です" };
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY 未設定" }; }
  const { data: r } = await admin.from("daily_reports").select("author, report_date").eq("id", reportId).maybeSingle();
  if (!r) return { ok: false, error: "日報が見つかりません" };
  const sender = access?.name?.trim() || "管理者";
  const body = `${message.trim()}\n\n— ${sender}`;
  const title = `日報メッセージ（${(r as any).report_date}）`;
  const { error } = await admin.from("notifications").insert({ recipient: (r as any).author, title, body, kind: "feedback" });
  if (error) return { ok: false, error: error.message };
  // 日報側にも返信記録を残す（一覧で「返信済」が分かるように）。列が無い環境でも失敗させない。
  try {
    await admin.from("daily_reports").update({ replied_at: new Date().toISOString(), replied_by: sender, reply_text: message.trim() }).eq("id", reportId);
  } catch { /* 列未整備（daily-reports-reply.sql 未実行）でも送信自体は成功 */ }
  revalidatePath("/reports"); revalidatePath("/notifications");
  return { ok: true };
}
