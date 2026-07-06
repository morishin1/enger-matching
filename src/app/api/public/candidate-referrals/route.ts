// ============================================================
// ENGER business（enger-lp）向け：「エージェントに人材を紹介」API。
//   企業ダッシュボードの「エージェントに紹介」モーダルから呼ぶ。
//   人材マスタへの直接登録ではなく、まず紹介（enger.client_referrals）として受け取り、
//   エージェントが内容確認のうえ人材登録する運用（Slack で社内に即時通知）。
//   ・POST … 紹介を送信（AI下書き /api/public/ai-draft kind=candidate と項目互換）
//   ・GET  … 自社の紹介履歴と対応状況（new/contacted/registered/closed）
//   認証：Bearer。承認済み（active）の法人アカウントのみ＝「承認をうけたらフル機能」。
// ============================================================
import { NextRequest, NextResponse } from "next/server";
import { engerAdmin, dbConfigured } from "@/lib/supabase";
import { bizCorsHeaders, resolveBusinessViewer } from "@/lib/business-api";
import { sanitizeCandidateDraft } from "@/lib/business-ai";
import { notifySlack, appUrl } from "@/lib/slack";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const METHODS = "GET,POST,OPTIONS";

export function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: bizCorsHeaders(req.headers.get("origin"), METHODS) });
}

export async function GET(req: NextRequest) {
  const cors = bizCorsHeaders(req.headers.get("origin"), METHODS);
  const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: cors });
  if (!dbConfigured) return json({ ok: false, error: "DB未設定" }, 503);
  const viewer = await resolveBusinessViewer(req);
  if (!viewer.ok) return json({ ok: false, error: viewer.error }, viewer.status);

  try {
    const sb = engerAdmin();
    const r: any = await sb.from("client_referrals")
      .select("id, initials, title, skills, rate, exp, avail, location, note, status, registered_candidate_no, created_at")
      .eq("company", viewer.companyName).order("created_at", { ascending: false }).limit(200);
    if (r.error) {
      if (/client_referrals|relation|schema cache/i.test(r.error.message ?? "")) {
        return json({ ok: false, error: "紹介テーブルが未整備です（supabase/client-referrals.sql を実行してください）" }, 503);
      }
      return json({ ok: false, error: r.error.message }, 500);
    }
    return json({ ok: true, referrals: r.data ?? [] });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
}

export async function POST(req: NextRequest) {
  const cors = bizCorsHeaders(req.headers.get("origin"), METHODS);
  const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: cors });
  if (!dbConfigured) return json({ ok: false, error: "DB未設定" }, 503);
  const viewer = await resolveBusinessViewer(req);
  if (!viewer.ok) return json({ ok: false, error: viewer.error }, viewer.status);

  let body: any = null;
  try { body = await req.json(); } catch { return json({ ok: false, error: "JSONボディが必要です" }, 400); }

  const d = sanitizeCandidateDraft(body ?? {});
  const name = String(body?.name ?? "").trim().slice(0, 60) || null;
  const initials = d.initials?.trim() || (name ? `${name[0]}.` : "");
  if (!initials) return json({ ok: false, error: "イニシャル（または氏名）を入力してください" }, 422);
  if (!d.skills || d.skills.length === 0) return json({ ok: false, error: "スキルを1つ以上入力してください" }, 422);

  try {
    const sb = engerAdmin();
    const ins: any = await sb.from("client_referrals").insert({
      company: viewer.companyName,
      referred_by: viewer.email,
      name,
      initials,
      title: d.title ?? null,
      skills: d.skills,
      rate: d.rate ?? null,
      exp: d.exp ?? null,
      avail: d.avail ?? null,
      location: d.location ?? null,
      note: d.note ?? null,
      status: "new",
    }).select("id").maybeSingle();
    if (ins.error) {
      if (/client_referrals|relation|schema cache/i.test(ins.error.message ?? "")) {
        return json({ ok: false, error: "紹介テーブルが未整備です（supabase/client-referrals.sql を実行してください）" }, 503);
      }
      return json({ ok: false, error: ins.error.message }, 500);
    }

    // Slack で社内に即時通知（エージェントが受けて人材登録へ）。
    try {
      await notifySlack({
        text: `🤝 企業からの人材紹介：${viewer.companyName} / ${initials}（${d.title ?? "職種未記入"}）`,
        blocks: [
          { type: "section", text: { type: "mrkdwn", text: `*🤝 企業からの人材紹介が届きました*\n• 紹介元: *${viewer.companyName}*（${viewer.email}）\n• 人材: *${initials}*${d.title ? ` / ${d.title}` : ""}${d.rate ? ` / ${d.rate}` : ""}\n• スキル: ${d.skills.slice(0, 8).join(", ")}${d.note ? `\n• 補足: ${d.note.slice(0, 200)}` : ""}` } },
          { type: "context", elements: [{ type: "mrkdwn", text: `内容を確認して <${appUrl("/people")}|人材管理> へ登録してください（登録後は client_referrals.status を registered に更新）` }] },
        ],
      });
    } catch { /* Slack 失敗は無視 */ }

    return json({ ok: true, id: ins.data?.id ?? null, status: "new" }, 201);
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
}
