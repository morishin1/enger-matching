"use server";

// KGIダッシュボードの月間売上目標（手動）とAI逆算（週次/日次KPIの割り振り元＝月次KPI）を保存する。
import { revalidatePath } from "next/cache";
import { engerAdmin } from "@/lib/supabase";
import { currentAccess } from "@/lib/accounts";
import { canManageDept } from "@/lib/roles";
import { callLLM, parseJsonLoose } from "@/lib/llm";
import { businessDaysInMonth } from "@/lib/person-kgi";
import { monthlyFromTarget, meetingCapacityMonth, clampDeal, clampRate, DEFAULT_AVG_DEAL_MAN, DEFAULT_CONV, DEFAULT_MTG_PER_PERSON_DAY, type KgiConv, type KgiHeadcount, type KgiPlan, type KgiWeekOverrides } from "@/lib/kgi-plan";

const MONTH_RE = /^\d{4}-\d{2}-01$/;

async function requireManager() {
  const access = await currentAccess();
  if (!access) return { ok: false as const, error: "ログインが必要です" };
  if (access.role !== "admin" && !canManageDept(access.teamRole)) return { ok: false as const, error: "管理者/マネージャーのみ設定できます" };
  return { ok: true as const, access };
}

const toCount = (v: unknown): number | null =>
  v == null || !Number.isFinite(Number(v)) ? null : Math.max(0, Math.min(9999, Math.floor(Number(v))));

/** 月間売上目標（万円）＋平均単価＋インサイド/アウトサイドの人員配分を手動保存する。 */
export async function saveKgiSalesTarget(input: { month: string; salesTargetMan: number | null; avgDealMan?: number | null; insideCount?: number | null; outsideCount?: number | null }): Promise<{ ok: boolean; error?: string }> {
  const g = await requireManager();
  if (!g.ok) return g;
  if (!MONTH_RE.test(input.month)) return { ok: false, error: "月の指定が不正です" };
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }
  const val = input.salesTargetMan == null || !Number.isFinite(Number(input.salesTargetMan))
    ? null : Math.max(0, Math.round(Number(input.salesTargetMan)));
  const avg = input.avgDealMan == null || !Number.isFinite(Number(input.avgDealMan))
    ? null : Math.max(0, Math.round(Number(input.avgDealMan)));
  const row: Record<string, unknown> = {
    month: input.month, sales_target_man: val, avg_deal_man: avg, inside_count: toCount(input.insideCount), outside_count: toCount(input.outsideCount),
    updated_by_email: g.access.email, updated_by_name: g.access.name ?? null, updated_at: new Date().toISOString(),
  };
  let r: any = await admin.from("kgi_sales_plan").upsert(row, { onConflict: "month" });
  // avg_deal_man / headcount 列が未マイグレーションの環境では、その列を外して再試行（機能低下だが動作は継続）。
  if (r.error && /avg_deal_man|column/i.test(r.error.message ?? "")) {
    delete row.avg_deal_man;
    r = await admin.from("kgi_sales_plan").upsert(row, { onConflict: "month" });
  }
  if (r.error && /inside_count|outside_count|column/i.test(r.error.message ?? "")) {
    delete row.inside_count; delete row.outside_count;
    r = await admin.from("kgi_sales_plan").upsert(row, { onConflict: "month" });
  }
  if (r.error) {
    if (/relation|kgi_sales_plan|does not exist/i.test(r.error.message)) return { ok: false, error: "テーブル未作成です（supabase/kgi-sales-plan.sql を実行してください）" };
    return { ok: false, error: r.error.message };
  }
  revalidatePath("/kgi");
  return { ok: true };
}

/** 週次カレンダーの目標上書き（KPIキー→週配列）を保存。null/空で「自動配分に戻す」。
 *  各セルは 0〜9999 の整数、または null（その週×KPIは自動配分にフォールバック）。 */
export async function saveKgiWeekOverrides(input: { month: string; overrides: KgiWeekOverrides | null }): Promise<{ ok: boolean; error?: string }> {
  const g = await requireManager();
  if (!g.ok) return g;
  if (!MONTH_RE.test(input.month)) return { ok: false, error: "月の指定が不正です" };
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }

  // 入力を正規化：許可KPIのみ・各値は整数(0-9999) or null。空配列/全nullは省いて、全て空なら null にする。
  let clean: KgiWeekOverrides | null = null;
  if (input.overrides) {
    const out: KgiWeekOverrides = {};
    for (const key of ["proposal", "meeting", "placement", "appointment"] as (keyof KgiWeekOverrides)[]) {
      const arr = input.overrides[key];
      if (!Array.isArray(arr)) continue;
      const norm = arr.map((v) => (v == null || !Number.isFinite(Number(v)) ? null : Math.max(0, Math.min(9999, Math.floor(Number(v))))));
      if (norm.some((v) => v != null)) out[key] = norm;
    }
    if (Object.keys(out).length > 0) clean = out;
  }

  const row: Record<string, unknown> = {
    month: input.month, week_overrides: clean,
    updated_by_email: g.access.email, updated_by_name: g.access.name ?? null, updated_at: new Date().toISOString(),
  };
  const r: any = await admin.from("kgi_sales_plan").upsert(row, { onConflict: "month" });
  if (r.error) {
    if (/week_overrides|column/i.test(r.error.message ?? "")) return { ok: false, error: "週次目標の上書き列が未作成です（supabase/kgi-week-overrides.sql を実行してください）" };
    if (/relation|kgi_sales_plan|does not exist/i.test(r.error.message ?? "")) return { ok: false, error: "テーブル未作成です（supabase/kgi-sales-plan.sql を実行してください）" };
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

const PLAN_SYSTEM = "あなたはSES（客先常駐エンジニア）営業のKPI設計アシスタントです。月間売上目標と人員配分（インサイド/アウトサイド）から逆算し、達成に必要な平均単価・各段階の転換率と、現場容量（1人1日の打ち合わせは3件程度が限度）を踏まえた実現条件を提案します。SESの本質は需要（案件＝エンド直の獲得）と供給（人材＝フリーランス/PP/BPの確保）の両面。数を増やすより単価・転換率・良質な案件/人材の確保が効きます。出力は指定のJSONのみ（説明文なし）。";

/** 売上目標＋人員配分からAIで逆算し、月次KPI（稼働人数/面談/提案/打ち合わせ）＋実現条件を保存する。 */
export async function computeKgiPlan(input: { month: string }): Promise<{ ok: boolean; plan?: KgiPlan; usedAI?: boolean; error?: string }> {
  const g = await requireManager();
  if (!g.ok) return g;
  if (!MONTH_RE.test(input.month)) return { ok: false, error: "月の指定が不正です" };
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }

  // 売上目標＋平均単価＋人員配分を取得（未設定なら計算不可）。列が無い環境ではフォールバック。
  let cur: any = await admin.from("kgi_sales_plan").select("sales_target_man, avg_deal_man, inside_count, outside_count").eq("month", input.month).maybeSingle();
  if (cur.error && /avg_deal_man|column/i.test(cur.error.message ?? "")) {
    cur = await admin.from("kgi_sales_plan").select("sales_target_man, inside_count, outside_count").eq("month", input.month).maybeSingle();
  }
  if (cur.error && /inside_count|outside_count|column/i.test(cur.error.message ?? "")) {
    cur = await admin.from("kgi_sales_plan").select("sales_target_man").eq("month", input.month).maybeSingle();
  }
  const target = cur?.data?.sales_target_man != null ? Number(cur.data.sales_target_man) : 0;
  if (!target || target <= 0) return { ok: false, error: "先に月間売上目標を入力してください" };
  const headcount: KgiHeadcount = {
    inside: cur?.data?.inside_count != null ? Math.max(0, Math.floor(Number(cur.data.inside_count))) : 0,
    outside: cur?.data?.outside_count != null ? Math.max(0, Math.floor(Number(cur.data.outside_count))) : 0,
  };
  const bizDays = businessDaysInMonth(input.month);
  const capacity = meetingCapacityMonth(headcount, bizDays, DEFAULT_MTG_PER_PERSON_DAY);

  // 平均単価は「手入力」を優先（無ければ実データ概算）。逆算の分母として固定し、AIは転換率のみ調整する。
  const manualAvg = cur?.data?.avg_deal_man != null ? Number(cur.data.avg_deal_man) : null;
  const baseAvgDeal = manualAvg != null && manualAvg > 0 ? clampDeal(manualAvg) : await avgDealFromData(admin);

  // AIに「平均単価・転換率・実現条件」を現実的な値で決めてもらう（件数の確定はコード側で行い整合を保証）。
  let avgDealMan = baseAvgDeal;
  let conv: KgiConv = { ...DEFAULT_CONV };
  let rationale = "";
  let advice = "";
  let usedAI = false;
  try {
    const heads = headcount.inside + headcount.outside;
    const prompt = `月間売上目標: ${Math.round(target)}万円
平均単価（手入力・固定。変更しない）: ${baseAvgDeal}万円/名・月
人員配分: インサイド ${headcount.inside}名 / アウトサイド ${headcount.outside}名（合計 ${heads}名）
当月営業日: ${bizDays}日
打ち合わせ容量の目安: ${heads}名 × 3件/人日 × ${bizDays}営業日 = 約${capacity}件/月（これを大きく超える打ち合わせ目標は非現実的）
既定の転換率: 打ち合わせ→提案=${DEFAULT_CONV.appointmentToProposal}, 提案→面談=${DEFAULT_CONV.proposalToMeeting}, 面談→稼働=${DEFAULT_CONV.meetingToPlacement}

平均単価は上記で固定です。この売上目標を達成するために妥当な各段階の「転換率」を提案してください。
既定値から大きく外れない現実的な範囲で微調整して構いません。
さらに、打ち合わせ目標が上記の容量に収まらない場合の「実現条件」を一文で（例：単価↑ / 転換率↑ / 増員 / エンド直案件の獲得 / フリーランス・BP人材の確保 など、SESで効く打ち手を具体的に）。
次のJSONのみを出力（数値のみ・件数・平均単価は含めない）:
{
  "conv": { "appointmentToProposal": 0〜1, "proposalToMeeting": 0〜1, "meetingToPlacement": 0〜1 },
  "rationale": "逆算の根拠を一文（80字以内）",
  "advice": "実現条件・打ち手を一文（100字以内）"
}`;
    const r = await callLLM({ system: PLAN_SYSTEM, prompt, maxTokens: 500, temperature: 0.2 });
    if (r.ok && r.text) {
      const p = parseJsonLoose<{ conv?: Partial<KgiConv>; rationale?: string; advice?: string }>(r.text);
      if (p) {
        // 平均単価は手入力を固定（AIでは変更しない）。
        conv = {
          appointmentToProposal: clampRate(p.conv?.appointmentToProposal, DEFAULT_CONV.appointmentToProposal),
          proposalToMeeting: clampRate(p.conv?.proposalToMeeting, DEFAULT_CONV.proposalToMeeting),
          meetingToPlacement: clampRate(p.conv?.meetingToPlacement, DEFAULT_CONV.meetingToPlacement),
        };
        rationale = typeof p.rationale === "string" ? p.rationale.slice(0, 120) : "";
        advice = typeof p.advice === "string" ? p.advice.slice(0, 160) : "";
        usedAI = true;
      }
    }
  } catch { /* AI失敗時は既定値で逆算（下でフォールバック） */ }

  const monthly = monthlyFromTarget(target, avgDealMan, conv);
  // 打ち合わせ目標が容量に収まるか（人員未入力＝容量0のときは判定しない＝feasible扱い）。
  const feasible = capacity <= 0 ? true : monthly.appointment <= capacity;
  if (!advice && !feasible) {
    advice = `打ち合わせ目標(${monthly.appointment}件)が容量(約${capacity}件)を超過。単価↑・転換率↑・増員、またはエンド直案件/FL・BP人材の確保で必要数を圧縮してください。`;
  }
  const plan: KgiPlan = { avgDealMan, conv, monthly, headcount, mtgPerPersonDay: DEFAULT_MTG_PER_PERSON_DAY, feasible, advice, rationale };

  const up: any = await admin.from("kgi_sales_plan").upsert({
    month: input.month, plan,
    updated_by_email: g.access.email, updated_by_name: g.access.name ?? null, updated_at: new Date().toISOString(),
  }, { onConflict: "month" });
  if (up.error) return { ok: false, error: up.error.message };
  revalidatePath("/kgi");
  return { ok: true, plan, usedAI };
}
