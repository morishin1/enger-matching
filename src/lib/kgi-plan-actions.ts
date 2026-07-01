"use server";

// KGIダッシュボードの月間売上目標（手動）とAI逆算（週次/日次KPIの割り振り元＝月次KPI）を保存する。
import { revalidatePath } from "next/cache";
import { engerAdmin } from "@/lib/supabase";
import { currentAccess } from "@/lib/accounts";
import { canManageDept } from "@/lib/roles";
import { callLLM, parseJsonLoose } from "@/lib/llm";
import { monthlyFromTarget, clampDeal, clampRate, DEFAULT_AVG_DEAL_MAN, DEFAULT_CONV, type KgiConv, type KgiPlan } from "@/lib/kgi-plan";

const MONTH_RE = /^\d{4}-\d{2}-01$/;

async function requireManager() {
  const access = await currentAccess();
  if (!access) return { ok: false as const, error: "ログインが必要です" };
  if (access.role !== "admin" && !canManageDept(access.teamRole)) return { ok: false as const, error: "管理者/マネージャーのみ設定できます" };
  return { ok: true as const, access };
}

/** 月間売上目標（万円）を手動保存する。 */
export async function saveKgiSalesTarget(input: { month: string; salesTargetMan: number | null }): Promise<{ ok: boolean; error?: string }> {
  const g = await requireManager();
  if (!g.ok) return g;
  if (!MONTH_RE.test(input.month)) return { ok: false, error: "月の指定が不正です" };
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }
  const val = input.salesTargetMan == null || !Number.isFinite(Number(input.salesTargetMan))
    ? null : Math.max(0, Math.round(Number(input.salesTargetMan)));
  const r: any = await admin.from("kgi_sales_plan").upsert({
    month: input.month, sales_target_man: val,
    updated_by_email: g.access.email, updated_by_name: g.access.name ?? null, updated_at: new Date().toISOString(),
  }, { onConflict: "month" });
  if (r.error) {
    if (/relation|kgi_sales_plan|does not exist/i.test(r.error.message)) return { ok: false, error: "テーブル未作成です（supabase/kgi-sales-plan.sql を実行してください）" };
    return { ok: false, error: r.error.message };
  }
  revalidatePath("/kgi");
  return { ok: true };
}

// engagements の平均月額（万円）を概算（AIの前提の初期値）。取れなければ既定。
async function avgDealFromData(admin: ReturnType<typeof engerAdmin>): Promise<number> {
  try {
    const r: any = await admin.from("engagements").select("monthly_rate, status").limit(1000);
    const vals: number[] = [];
    for (const e of (r.data ?? [])) {
      if (String(e.status ?? "") === "終了") continue;
      const n = Number(e.monthly_rate);
      if (Number.isFinite(n) && n > 0) vals.push(n);
    }
    if (vals.length === 0) return DEFAULT_AVG_DEAL_MAN;
    return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  } catch { return DEFAULT_AVG_DEAL_MAN; }
}

const PLAN_SYSTEM = "あなたは人材紹介（SES/エージェント）の営業KPI設計アシスタントです。月間売上目標から逆算し、達成に必要な平均単価と各段階の転換率を、現実的な値で提案します。出力は指定のJSONのみ（説明文なし）。";

/** 売上目標からAIで逆算し、月次KPI（稼働人数/面談/提案/打ち合わせ）を割り振って保存する。 */
export async function computeKgiPlan(input: { month: string }): Promise<{ ok: boolean; plan?: KgiPlan; usedAI?: boolean; error?: string }> {
  const g = await requireManager();
  if (!g.ok) return g;
  if (!MONTH_RE.test(input.month)) return { ok: false, error: "月の指定が不正です" };
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }

  // 売上目標を取得（未設定なら計算不可）。
  const cur: any = await admin.from("kgi_sales_plan").select("sales_target_man").eq("month", input.month).maybeSingle();
  const target = cur?.data?.sales_target_man != null ? Number(cur.data.sales_target_man) : 0;
  if (!target || target <= 0) return { ok: false, error: "先に月間売上目標を入力してください" };

  const baseAvgDeal = await avgDealFromData(admin);

  // AIに「平均単価・転換率」を現実的な値で決めてもらう（件数の確定はコード側で行い整合を保証）。
  let avgDealMan = baseAvgDeal;
  let conv: KgiConv = { ...DEFAULT_CONV };
  let rationale = "";
  let usedAI = false;
  try {
    const prompt = `月間売上目標: ${Math.round(target)}万円
現状の平均月額単価（実データ概算）: ${baseAvgDeal}万円/名・月
既定の転換率: 打ち合わせ→提案=${DEFAULT_CONV.appointmentToProposal}, 提案→面談=${DEFAULT_CONV.proposalToMeeting}, 面談→稼働=${DEFAULT_CONV.meetingToPlacement}

上記を踏まえ、この売上目標を達成するために妥当な「平均単価」と各段階の「転換率」を提案してください。
現状値や既定値から大きく外れないように、現実的な範囲で微調整して構いません。
次のJSONのみを出力（数値のみ・件数は含めない）:
{
  "avgDealMan": 数値(万円/名・月),
  "conv": { "appointmentToProposal": 0〜1, "proposalToMeeting": 0〜1, "meetingToPlacement": 0〜1 },
  "rationale": "根拠を一文（80字以内）"
}`;
    const r = await callLLM({ system: PLAN_SYSTEM, prompt, maxTokens: 400, temperature: 0.2 });
    if (r.ok && r.text) {
      const p = parseJsonLoose<{ avgDealMan?: number; conv?: Partial<KgiConv>; rationale?: string }>(r.text);
      if (p) {
        avgDealMan = clampDeal(p.avgDealMan ?? baseAvgDeal);
        conv = {
          appointmentToProposal: clampRate(p.conv?.appointmentToProposal, DEFAULT_CONV.appointmentToProposal),
          proposalToMeeting: clampRate(p.conv?.proposalToMeeting, DEFAULT_CONV.proposalToMeeting),
          meetingToPlacement: clampRate(p.conv?.meetingToPlacement, DEFAULT_CONV.meetingToPlacement),
        };
        rationale = typeof p.rationale === "string" ? p.rationale.slice(0, 120) : "";
        usedAI = true;
      }
    }
  } catch { /* AI失敗時は既定値で逆算（下でフォールバック） */ }

  const monthly = monthlyFromTarget(target, avgDealMan, conv);
  const plan: KgiPlan = { avgDealMan, conv, monthly, rationale };

  const up: any = await admin.from("kgi_sales_plan").upsert({
    month: input.month, plan,
    updated_by_email: g.access.email, updated_by_name: g.access.name ?? null, updated_at: new Date().toISOString(),
  }, { onConflict: "month" });
  if (up.error) return { ok: false, error: up.error.message };
  revalidatePath("/kgi");
  return { ok: true, plan, usedAI };
}
