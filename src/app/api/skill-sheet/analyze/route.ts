// 単一人材のスキルシートを AI 解析して DB に保存する API。
//   POST /api/skill-sheet/analyze { candidate_no | candidate_id, force? }
//   - 既に解析済み（skill_sheet_extracted_at）はスキップ（force=true で再実行）
//   - GOOGLE_SERVICE_ACCOUNT_JSON 未設定なら 503 を返す
import { engerAdmin } from "@/lib/supabase";
import { analyzeSkillSheet, driveConfigured } from "@/lib/skill-sheet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json" } });

export async function POST(req: Request) {
  if (!driveConfigured()) return json({ ok: false, error: "GOOGLE_SERVICE_ACCOUNT_JSON 未設定" }, 503);
  let body: any; try { body = await req.json(); } catch { return json({ ok: false, error: "不正なリクエスト" }, 400); }
  const force = !!body?.force;
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return json({ ok: false, error: "サーバ設定エラー" }, 500); }

  let q = admin.from("candidates").select("id, candidate_no, name, skill_sheet_url, skill_sheet_extracted_at, skills").limit(1);
  if (body?.candidate_no != null) q = q.eq("candidate_no", Number(body.candidate_no));
  else if (body?.candidate_id) q = q.eq("id", String(body.candidate_id));
  else return json({ ok: false, error: "candidate_no か candidate_id が必要" }, 400);
  const r = await q.maybeSingle();
  if (r.error || !r.data) return json({ ok: false, error: "人材が見つかりません" }, 404);
  const c: any = r.data;
  if (!c.skill_sheet_url) return json({ ok: false, error: "スキルシートURL が未設定" }, 400);
  if (!force && c.skill_sheet_extracted_at) return json({ ok: true, skipped: true, reason: "既に解析済み（force=trueで再解析可）" });

  const res = await analyzeSkillSheet(c.skill_sheet_url);
  const now = new Date().toISOString();
  if (!res.ok) {
    await admin.from("candidates").update({ skill_sheet_error: res.error, skill_sheet_extracted_at: now }).eq("id", c.id);
    return json({ ok: false, error: res.error });
  }
  // 手入力skills と AI抽出skills を和集合（マッチング採点で同等に扱う）
  const cur: string[] = Array.isArray(c.skills) ? c.skills : [];
  const ai = res.skills;
  const merged = Array.from(new Set([...cur, ...ai]));
  await admin.from("candidates").update({
    skill_sheet_summary: res.summary,
    skill_sheet_skills: ai,
    skill_sheet_extracted_at: now,
    skill_sheet_error: null,
    skills: merged,
  }).eq("id", c.id);
  return json({ ok: true, summary: res.summary, skills: ai, addedToSkills: merged.length - cur.length });
}
