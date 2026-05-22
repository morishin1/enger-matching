"use server";

import { revalidatePath } from "next/cache";
import { engerAdmin } from "@/lib/supabase";
import { authServerClient, authConfigured } from "@/lib/supabase-auth";
import { resolveAccess } from "@/lib/accounts";
import { matchRules, type QualityRule } from "@/lib/quality";

type Result = { ok: boolean; error?: string; applied?: number };

async function requireAdmin(): Promise<Result> {
  if (!authConfigured) return { ok: true };
  try {
    const sb = await authServerClient();
    const { data: { user } } = await sb.auth.getUser();
    const a = user?.email ? await resolveAccess(user.email) : null;
    return a?.role === "admin" && a.status === "active" ? { ok: true } : { ok: false, error: "管理者権限が必要です" };
  } catch (e: any) { return { ok: false, error: String(e?.message ?? e) }; }
}

/** ルールの有効/無効・しきい値を更新。 */
export async function updateRule(id: string, patch: { enabled?: boolean; threshold?: number | null }): Promise<Result> {
  const g = await requireAdmin(); if (!g.ok) return g;
  try {
    const sb = engerAdmin();
    const { error } = await sb.from("quality_rules").update(patch).eq("id", id);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/settings");
    return { ok: true };
  } catch (e: any) { return { ok: false, error: String(e?.message ?? e) }; }
}

/** 有効ルールを現在の提案に適用し、該当を disqualified に。 */
export async function applyRules(): Promise<Result> {
  const g = await requireAdmin(); if (!g.ok) return g;
  try {
    const sb = engerAdmin();
    const [rulesRes, propRes] = await Promise.all([
      sb.from("quality_rules").select("id, kind, label, enabled, threshold"),
      sb.from("proposals").select("id, stage, caller_status, created_at, score, ai_match, company, job_title, disqualified").limit(2000),
    ]);
    if (rulesRes.error) return { ok: false, error: rulesRes.error.message };
    if (propRes.error) return { ok: false, error: propRes.error.message };
    const rules = (rulesRes.data ?? []) as QualityRule[];
    const hits = matchRules(propRes.data ?? [], rules);
    if (hits.length === 0) return { ok: true, applied: 0 };

    // まとめて更新（理由ごと）
    const now = new Date().toISOString();
    const byReason = new Map<string, string[]>();
    for (const h of hits) { const a = byReason.get(h.reason) ?? []; a.push(h.id); byReason.set(h.reason, a); }
    for (const [reason, ids] of byReason) {
      const { error } = await sb.from("proposals").update({ disqualified: true, dq_reason: reason, dq_at: now }).in("id", ids);
      if (error) return { ok: false, error: error.message };
    }
    revalidatePath("/settings");
    revalidatePath("/");
    return { ok: true, applied: hits.length };
  } catch (e: any) { return { ok: false, error: String(e?.message ?? e) }; }
}

/** NG除外を全解除（やり直し用）。 */
export async function resetDisqualified(): Promise<Result> {
  const g = await requireAdmin(); if (!g.ok) return g;
  try {
    const sb = engerAdmin();
    const { error } = await sb.from("proposals").update({ disqualified: false, dq_reason: null, dq_at: null }).eq("disqualified", true);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/settings");
    revalidatePath("/");
    return { ok: true };
  } catch (e: any) { return { ok: false, error: String(e?.message ?? e) }; }
}
