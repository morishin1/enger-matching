"use server";

import { revalidatePath } from "next/cache";
import { engerAdmin } from "@/lib/supabase";
import { callLLM } from "@/lib/llm";
import { logUsage } from "@/lib/ai-usage";
import { currentAccess, listDepartmentMemberNames } from "@/lib/accounts";
import { canManageDept } from "@/lib/roles";

/** 日報への返信権限：admin、または対象著者が自部署に属するマネージャー/リーダー。 */
async function canReplyToReport(access: Awaited<ReturnType<typeof currentAccess>>, author: string): Promise<boolean> {
  if (!access) return true; // 認証未設定(ローカル)は許可
  if (access.role === "admin") return true;
  if (canManageDept(access.teamRole) && access.department) {
    const members = await listDepartmentMemberNames(access.department);
    return members.includes(author) || author === access.name;
  }
  return false;
}

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

  // 日報提出時の AI 自動返信（基本ON・1日報につき1回）。
  //   提出した本人の「お知らせ」に、承認＋次の一手の短い一言が即座に届く。
  //   AI 失敗や列未整備でも日報保存自体は成功させる（fail-soft）。
  try {
    const { data: saved } = await admin.from("daily_reports")
      .select("id, ai_replied_at, ai_comment").eq("author", row.author).eq("report_date", row.report_date).maybeSingle();
    if (saved && !(saved as any).ai_replied_at) {
      await autoReplyToReport((saved as any).id, row).catch(() => {});
    }
  } catch { /* fail-soft */ }

  revalidatePath("/reports");
  return { ok: true };
}

/** 日報提出時に AI が一言を生成し、本人の「お知らせ」に届ける（自動・内部関数）。 */
async function autoReplyToReport(reportId: string, r: { author: string; report_date: string; did: string[]; self_check: Record<string, string>; good: string | null; problem: string | null; cause: string | null; next_action: string | null; mood: string | null; metrics: any }): Promise<void> {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return; }
  const m = r.metrics ?? {};
  const system = "あなたはメンバーを温かく支える人材紹介エージェントのマネージャーです。提出された日報へ、その日のうちに届く短い返信を書きます。①頑張りや工夫を1つ具体的に承認、②明日に向けた前向きな一言かヒントを1つ。日本語で2〜4行、絵文字は控えめに、説教くさくしない。";
  const prompt = [
    `担当者: ${r.author}`,
    `日付: ${r.report_date}`,
    `本日実績: 提案${m.proposalsToday ?? 0} / 打合せ${m.meetingsToday ?? 0}`,
    `やったこと: ${(r.did ?? []).join("、") || "（記載なし）"}`,
    `自己チェック: ${JSON.stringify(r.self_check ?? {})}`,
    `うまくいった: ${r.good ?? "（なし）"}`,
    `詰まった/課題: ${r.problem ?? "（なし）"}（なぜ: ${r.cause ?? "—"}）`,
    `明日の一手: ${r.next_action ?? "（なし）"}`,
    `手応え: ${r.mood ?? ""}`,
  ].join("\n");

  // 安価モデル（Haiku）を選好してコストを抑える。
  const prev = process.env.LLM_MODEL;
  if (!prev || !/haiku/i.test(prev)) process.env.LLM_MODEL = "claude-haiku-4-5";
  const res = await callLLM({ system, prompt, maxTokens: 220, temperature: 0.6 });
  if (prev) process.env.LLM_MODEL = prev; else delete process.env.LLM_MODEL;
  if (!res.ok || !res.text?.trim()) return;
  try { await logUsage("report_auto_reply", res.model, res.usage); } catch { /* noop */ }

  const text = res.text.trim();
  const now = new Date().toISOString();
  // 本人のお知らせへ届ける
  await admin.from("notifications").insert({
    recipient: r.author,
    title: `日報へのひとこと（${r.report_date}）`,
    body: `${text}\n\n— ENGER（AI）`,
    kind: "feedback",
  });
  // 日報側にも記録（カード表示・重複防止）
  await admin.from("daily_reports").update({ ai_comment: text, ai_replied_at: now }).eq("id", reportId);
  revalidatePath("/notifications");
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
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY 未設定" }; }
  const { data: r } = await admin.from("daily_reports").select("*").eq("id", reportId).maybeSingle();
  if (!r) return { ok: false, error: "日報が見つかりません" };
  if (!(await canReplyToReport(access, (r as any).author))) return { ok: false, error: "この日報に返信する権限がありません" };
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
  // 220 だと日本語で 110字程度で頭打ち→文末で切れていた。実運用に必要な分まで余裕を持たせる。
  const res = await callLLM({ system, prompt, maxTokens: 700, temperature: 0.6 });
  if (!res.ok) return { ok: false, error: res.error };
  await logUsage("report_message_draft", res.model, res.usage);
  return { ok: true, text: res.text };
}

/** 管理者：日報1件に対する個別メッセージを送信（notifications にレコード追加）。 */
export async function sendReportMessage(reportId: string, message: string): Promise<Result> {
  const access = await currentAccess();
  if (!message?.trim()) return { ok: false, error: "メッセージが空です" };
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY 未設定" }; }
  const { data: r } = await admin.from("daily_reports").select("author, report_date").eq("id", reportId).maybeSingle();
  if (!r) return { ok: false, error: "日報が見つかりません" };
  if (!(await canReplyToReport(access, (r as any).author))) return { ok: false, error: "この日報に返信する権限がありません" };
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

/** 日報の『確認した』チェック。役割ごとに独立して保存（管理者/マネージャー）。
 *   ・kind='admin'   : admin のみ実行可
 *   ・kind='manager' : manager/leader が実行可（admin も可）
 *   ・undo=true で解除（再度一覧に表示）。
 */
export async function markReportReviewed(reportId: string, kind: "admin" | "manager", undo: boolean = false): Promise<Result> {
  const access = await currentAccess();
  if (!access) return { ok: false, error: "認証が必要です" };
  if (kind === "admin" && access.role !== "admin") return { ok: false, error: "管理者権限が必要です" };
  if (kind === "manager") {
    const allowed = access.role === "admin" || canManageDept(access.teamRole);
    if (!allowed) return { ok: false, error: "マネージャー/リーダー権限が必要です" };
  }
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY 未設定" }; }
  const patch: Record<string, any> = undo
    ? (kind === "admin"
        ? { reviewed_by_admin_at: null, reviewed_by_admin_email: null, reviewed_by_admin_name: null }
        : { reviewed_by_manager_at: null, reviewed_by_manager_email: null, reviewed_by_manager_name: null })
    : (kind === "admin"
        ? { reviewed_by_admin_at: new Date().toISOString(), reviewed_by_admin_email: access.email, reviewed_by_admin_name: access.name ?? null }
        : { reviewed_by_manager_at: new Date().toISOString(), reviewed_by_manager_email: access.email, reviewed_by_manager_name: access.name ?? null });
  try {
    const { error } = await admin.from("daily_reports").update(patch).eq("id", reportId);
    if (error) {
      if (/column .* does not exist|reviewed_by/i.test(error.message)) {
        return { ok: false, error: "閲覧チェック列が未整備です（supabase/daily-reports-review.sql を実行してください）" };
      }
      return { ok: false, error: error.message };
    }
  } catch (e: any) { return { ok: false, error: String(e?.message ?? e) }; }
  // 確認したことを本人へお知らせ（fail-soft）。日報カードのバッジに加えてベルでも気づけるように。
  if (!undo) {
    try {
      const { data: r } = await admin.from("daily_reports").select("author, report_date").eq("id", reportId).maybeSingle();
      const author = (r as any)?.author?.trim();
      if (author && author !== (access.name ?? "").trim()) {
        await admin.from("notifications").insert({
          recipient: author,
          title: `日報を確認しました（${(r as any)?.report_date ?? ""}）`,
          body: `${access.name ?? (kind === "admin" ? "管理者" : "マネージャー")} さんがあなたの日報を確認しました。`,
          kind: "feedback",
        });
        revalidatePath("/notifications");
      }
    } catch { /* notifications 未整備でも確認チェックは成功扱い */ }
  }
  revalidatePath("/reports");
  return { ok: true };
}
