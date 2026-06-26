// ============================================================
// LINE WORKS Bot Webhook（Phase 1 MVP）
//   トークに届いた人材/案件メッセージを受信 → AIで構造化 → ENGERに自動登録(signup_source='line_works')
//   → スキル一致で自動マッチング → 上位候補をカルーセルでトークに返信。
//
//   ・署名検証（X-WORKS-Signature / Bot Secret）。未設定なら検証スキップ（開発用）。
//   ・「案件 / 人材」は先頭プレフィックス（例:「案件 …」「人材 …」）で判定。無ければAIで分類。
//   ・登録は name×company / title×client の既存突合（upsert*Manual）で重複を防止。
//   ・LINE WORKS 未設定時（env無し）は no-op で 200 を返す。
// ============================================================
import { NextRequest, NextResponse } from "next/server";
import { engerAdmin, dbConfigured } from "@/lib/supabase";
import { extractEntityFields, upsertCandidateManual, upsertJobManual, type CandidateInput, type JobInput } from "@/lib/actions";
import { rankCandidates, rankJobs } from "@/lib/match";
import { relatedSearchLabels } from "@/lib/skills";
import { lineworksConfigured, verifyWebhookSignature, sendBotMessage, textMessage, matchCarousel, diagnoseAuth, type LwTarget, type MatchColumn } from "@/lib/lineworks";
import { recordLineworksTarget } from "@/lib/lineworks-targets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE = (process.env.NEXT_PUBLIC_SITE_URL || "https://dx.enger.jp").replace(/\/$/, "");
const splitSkills = (s?: string) => (s ? s.split(/[,、\/／]+/).map((x) => x.trim()).filter(Boolean) : []);

/** 先頭プレフィックスで案件/人材を判定（例:「案件 …」「#人材 …」）。無ければ null。 */
function detectKindByPrefix(text: string): { kind: "jobs" | "candidates"; body: string } | null {
  const m = text.match(/^[\s　]*#?\s*(案件|求人|募集|人材|エンジニア|候補者?|job|cand(?:idate)?)\s*[:：>＞　-]*\s*/i);
  if (!m) return null;
  const kw = m[1].toLowerCase();
  const kind: "jobs" | "candidates" = /案件|求人|募集|job/.test(kw) ? "jobs" : "candidates";
  const body = text.slice(m[0].length).trim();
  return { kind, body: body || text };
}

/** プレフィックスが無いときに AI で案件/人材を分類。曖昧なら null。 */
async function classifyKind(text: string): Promise<"jobs" | "candidates" | null> {
  try {
    const { callLLM } = await import("@/lib/llm");
    const prev = process.env.LLM_MODEL;
    if (!prev || !/haiku/i.test(prev)) process.env.LLM_MODEL = "claude-haiku-4-5";
    const r = await callLLM({
      system: "あなたは分類器です。出力は job か candidate の1語のみ。",
      prompt: `次の文章は「案件(求人)」と「人材(エンジニア)」のどちらの情報ですか。job か candidate のどちらか1語だけ出力してください。判別できなければ unknown と出力。\n\n${text.slice(0, 2000)}`,
      maxTokens: 5,
      temperature: 0,
    });
    if (prev) process.env.LLM_MODEL = prev; else delete process.env.LLM_MODEL;
    if (!r.ok) return null;
    if (/cand/i.test(r.text)) return "candidates";
    if (/job/i.test(r.text)) return "jobs";
    return null;
  } catch {
    return null;
  }
}

/** 登録した人材に合う案件 上位3件。 */
async function topJobsForCandidate(admin: ReturnType<typeof engerAdmin>, candNo: number): Promise<{ cand: any; cols: MatchColumn[] }> {
  const cr: any = await admin.from("candidates")
    .select("id, candidate_no, name, title, skills, rate, salary_min, salary_max, remote_pref, exp, age_band, nationality, affiliation")
    .eq("candidate_no", candNo).maybeSingle();
  const cand = cr.data;
  if (!cand?.skills?.length) return { cand, cols: [] };
  const search = relatedSearchLabels(cand.skills, "parents");
  if (!search.length) return { cand, cols: [] };
  const jr: any = await admin.from("jobs")
    .select("id, job_no, title, role_label, skills, salary_min, salary_max, remote_type, client_name, flow_note, detail, start_date")
    .eq("is_published", true).overlaps("skills", search).order("job_no", { ascending: false }).limit(200);
  const ranked = rankJobs(cand as any, (jr.data ?? []) as any[], 3);
  const cols: MatchColumn[] = ranked.map((r: any, i: number) => ({
    title: `${i + 1}. ${r.job.title ?? "案件"}`,
    text: `マッチ度${r.score}% / ${(r.matchedSkills ?? []).slice(0, 4).join(", ")}`,
    url: `${BASE}/matching?person=${cand.candidate_no}&job=${r.job.job_no}`,
  }));
  return { cand, cols };
}

/** 登録した案件に合う人材 上位3件。 */
async function topCandidatesForJob(admin: ReturnType<typeof engerAdmin>, jobNo: number): Promise<{ job: any; cols: MatchColumn[] }> {
  const jr: any = await admin.from("jobs")
    .select("id, job_no, title, role_label, skills, salary_min, salary_max, remote_type, client_name, flow_note, detail, start_date")
    .eq("job_no", jobNo).maybeSingle();
  const job = jr.data;
  if (!job?.skills?.length) return { job, cols: [] };
  const search = relatedSearchLabels(job.skills, "children");
  if (!search.length) return { job, cols: [] };
  const cr: any = await admin.from("candidates")
    .select("id, candidate_no, name, title, skills, rate, salary_min, salary_max, remote_pref, exp, age_band, nationality, affiliation")
    .overlaps("skills", search).order("candidate_no", { ascending: false }).limit(200);
  const ranked = rankCandidates(job as any, (cr.data ?? []) as any[], 3);
  const cols: MatchColumn[] = ranked.map((r: any, i: number) => ({
    title: `${i + 1}. ${r.candidate.name ?? "人材"}`,
    text: `マッチ度${r.score}% / ${(r.matchedSkills ?? []).slice(0, 4).join(", ")}`,
    url: `${BASE}/matching?job=${job.job_no}&cand=${r.candidate.candidate_no}`,
  }));
  return { job, cols };
}

/** 1メッセージを処理（分類→抽出→登録→マッチング→返信）。 */
async function handleMessage(text: string, target: LwTarget): Promise<void> {
  const reply = (content: unknown) => sendBotMessage(target, content);

  // 1) 案件/人材の判定
  const pre = detectKindByPrefix(text);
  let kind = pre?.kind ?? null;
  const body = pre?.body ?? text;
  if (!kind) kind = await classifyKind(text);
  if (!kind) {
    await reply(textMessage("案件か人材かを判別できませんでした。先頭に「案件」または「人材」と付けて送ってください（例：『人材 …』『案件 …』）。"));
    return;
  }

  // 2) AI 抽出
  const ext = await extractEntityFields(kind, body);
  if (!ext.ok) { await reply(textMessage(`読み取りに失敗しました：${ext.error}`)); return; }
  const f = ext.fields;

  const admin = engerAdmin();
  if (kind === "candidates") {
    const input: CandidateInput = {
      name: (f.name && f.name.trim()) || "（LINE WORKS取込）",
      title: f.title ?? null, company: f.company ?? null, affiliation: f.affiliation ?? null,
      skills: splitSkills(f.skills), rate: f.rate ?? null, exp: f.exp ?? null, avail: f.avail ?? null,
      location: f.location ?? null, remote_pref: f.remote_pref ?? null, status: f.status ?? null,
      age_band: f.age_band ?? null, nationality: f.nationality ?? null, rank: f.rank ?? null,
      contact_name: f.contact_name ?? null, contact_email: f.contact_email ?? null, note: f.note ?? null,
      signup_source: "line_works",
    };
    const res = await upsertCandidateManual(input);
    if (!res.ok || res.candidate_no == null) { await reply(textMessage(`登録に失敗しました：${(res as any).error ?? "不明なエラー"}`)); return; }
    const { cand, cols } = await topJobsForCandidate(admin, res.candidate_no);
    await reply(textMessage(`✅ 人材「${cand?.name ?? input.name}」を登録しました（P-${String(res.candidate_no).padStart(5, "0")}）。${cols.length ? `合う案件 上位${cols.length}件：` : ""}`));
    if (cols.length) await reply(matchCarousel(cols));
    else await reply(textMessage(`合う案件が見つかりませんでした。スキル情報が少ない可能性があります。\n${BASE}/matching?person=${res.candidate_no} で確認できます。`));
  } else {
    const input: JobInput = {
      title: (f.title && f.title.trim()) || "（LINE WORKS取込案件）",
      client_name: f.client_name ?? null, role_label: f.role_label ?? null, skills: splitSkills(f.skills),
      salary_min: f.salary_min ? Number(f.salary_min) : null, salary_max: f.salary_max ? Number(f.salary_max) : null,
      remote_type: (["full_remote", "partial_remote", "onsite"].includes(f.remote_type) ? f.remote_type : null) as JobInput["remote_type"],
      flow_note: f.flow_note ?? null, work_location: f.work_location ?? null, start_date: f.start_date ?? null,
      detail: f.detail ?? null, status: f.status ?? null, contact_name: f.contact_name ?? null, contact_email: f.contact_email ?? null,
      signup_source: "line_works",
    };
    const res = await upsertJobManual(input);
    if (!res.ok || res.job_no == null) { await reply(textMessage(`登録に失敗しました：${(res as any).error ?? "不明なエラー"}`)); return; }
    const { job, cols } = await topCandidatesForJob(admin, res.job_no);
    await reply(textMessage(`✅ 案件「${job?.title ?? input.title}」を登録しました（No.${String(res.job_no).padStart(5, "0")}）。${cols.length ? `合う人材 上位${cols.length}名：` : ""}`));
    if (cols.length) await reply(matchCarousel(cols));
    else await reply(textMessage(`合う人材が見つかりませんでした。スキル情報が少ない可能性があります。\n${BASE}/matching?job=${res.job_no} で確認できます。`));
  }
}

/** ヘルスチェック（Webhook URL 登録時の疎通確認用）。
 *  `?selftest=1` を付けると実際にトークン取得を試し、失敗理由(JSON)を返す（原因切り分け用）。 */
export async function GET(req: NextRequest) {
  const selftest = new URL(req.url).searchParams.get("selftest") === "1";
  if (selftest) {
    const auth = lineworksConfigured() ? await diagnoseAuth() : { ok: false, error: "環境変数(LINEWORKS_*)が未設定です" };
    return NextResponse.json({ ok: true, service: "lineworks-webhook", configured: lineworksConfigured(), auth });
  }
  return NextResponse.json({ ok: true, service: "lineworks-webhook", configured: lineworksConfigured() });
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  // 署名検証（Bot Secret 設定時）。不正は 401。
  if (!verifyWebhookSignature(raw, req.headers.get("x-works-signature"))) {
    return NextResponse.json({ ok: false, error: "invalid signature" }, { status: 401 });
  }
  // 未設定（env無し）or DB未接続なら何もせず 200（LINE WORKS のリトライ抑止）。
  if (!lineworksConfigured() || !dbConfigured) return NextResponse.json({ ok: true, skipped: true });

  let body: any;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ ok: true }); }

  // テキストメッセージのみ処理。
  if (body?.type !== "message" || body?.content?.type !== "text" || !body?.content?.text) {
    return NextResponse.json({ ok: true, ignored: true });
  }
  const target: LwTarget = { channelId: body.source?.channelId ?? null, userId: body.source?.userId ?? null };
  // ENGER→LINE 共有の宛先候補として、このトークを記憶（fail-soft）。
  await recordLineworksTarget(target, String(body.content.text));
  try {
    await handleMessage(String(body.content.text), target);
  } catch (e) {
    // 失敗してもトークに簡易通知（fail-soft）。
    try { await sendBotMessage(target, textMessage("処理中にエラーが発生しました。お手数ですが内容を確認のうえ再送してください。")); } catch { /* noop */ }
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
  return NextResponse.json({ ok: true });
}
