import { NextRequest, NextResponse } from "next/server";
import { engerAdmin } from "@/lib/supabase";
import { isWeekendOrJpHoliday } from "@/lib/jp-holidays";

const VALID_ACTIONS = ["話を進める", "見送り"] as const;
type ActionType = (typeof VALID_ACTIONS)[number];

/** リンク切れ等の監視ログ。ダッシュボードの「要対応」で集計表示するため notifications に
 *  recipient='_system'（お知らせ画面には出ない値）で軽量ロギング。fail-soft。 */
async function logRespondError(method: "GET" | "POST", reason: string, ctx: { token?: string | null; action?: string | null }) {
  try {
    const admin = engerAdmin();
    const tokenHint = ctx.token ? ` token=${String(ctx.token).slice(0, 8)}…` : "";
    const actionHint = ctx.action ? ` action=${ctx.action}` : "";
    await admin.from("notifications").insert({
      recipient: "_system",
      title: "リンク切れ：メールの応答リンクが無効",
      body: `${method} /api/respond ${reason}${tokenHint}${actionHint}`,
      kind: "respond_broken",
    });
  } catch { /* 監視ログ失敗は本処理を止めない */ }
}

/** 承認時に提示された面談希望日時を、提案レコードの「メモ履歴」(proposal_memos) へ自動追記する。
 *  どちら側（案件側／人材側）から届いたかが分かるよう、送信元の側ラベルを本文に明記する。
 *  日時が1件も無ければ呼び出し側でスキップする。本処理（承認通知）は止めない fail-soft。 */
async function recordMeetingMemo(admin: ReturnType<typeof engerAdmin>, proposalId: string, candidates: string[], sideLabel: string) {
    try {
        const lines = candidates.map((c, i) => `・候補${i + 1}：${c}`).join("\n");
        const body = `【自動記録】承認時に${sideLabel}より面談希望日時の提示がありました。\n${lines}`;
        await admin.from("proposal_memos").insert({
            proposal_id: proposalId,
            category: "連絡記録",
            body,
            created_by_email: null,
            created_by_name: "自動記録",
        });
    } catch { /* メモ記録失敗は承認通知を止めない */ }
}

export async function POST(req: NextRequest) {
    const reqBody = await req.json().catch(() => ({}));
    const { token, action } = reqBody;
    // 面談希望日時（「2026/06/28 10:00」形式の文字列配列）。話を進める時のみ送られる想定。
    //   #259：土日祝はサーバー側でも除外（UI回避の防波堤）。
    const meetingCandidates: string[] = (Array.isArray(reqBody?.meetingCandidates)
        ? reqBody.meetingCandidates.filter((x: unknown) => typeof x === "string" && x.trim()).map((x: string) => x.trim())
        : []
    ).filter((s: string) => {
        const m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})/.exec(s);
        if (!m) return true; // 形式外はそのまま（従来挙動）
        return !isWeekendOrJpHoliday(`${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`);
    });
    if (!token || !VALID_ACTIONS.includes(action)) {
        await logRespondError("POST", "invalid request (token/action missing or unknown)", { token, action });
        return NextResponse.json({ ok: false, error: "invalid request" }, { status: 400 });
    }

    let admin: ReturnType<typeof engerAdmin>;
    try { admin = engerAdmin(); } catch {
        return NextResponse.json({ ok: false, error: "server config error" }, { status: 500 });
    }

    // token がどちらの側か判定
    const jobRes = await admin.from("proposals")
        .select("id, job_action_type")
        .eq("job_action_token", token)
        .maybeSingle();

    if (jobRes.data) {
        if (jobRes.data.job_action_type !== "未回答") {
            return NextResponse.json({ ok: false, error: "already_answered", current: jobRes.data.job_action_type });
        }
        const { error } = await admin.from("proposals")
            .update({ job_action_type: action as ActionType, updated_at: new Date().toISOString() })
            .eq("id", jobRes.data.id);
        if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
        // 案件側(job_action_token)からの送信 → メモには「案件側」と明記。
        if (action === "話を進める" && meetingCandidates.length) await recordMeetingMemo(admin, jobRes.data.id, meetingCandidates, "案件側");
        return NextResponse.json({ ok: true, side: "job", action });
    }

    const candRes = await admin.from("proposals")
        .select("id, cand_action_type")
        .eq("cand_action_token", token)
        .maybeSingle();

    if (candRes.data) {
        if (candRes.data.cand_action_type !== "未回答") {
            return NextResponse.json({ ok: false, error: "already_answered", current: candRes.data.cand_action_type });
        }
        const { error } = await admin.from("proposals")
            .update({ cand_action_type: action as ActionType, updated_at: new Date().toISOString() })
            .eq("id", candRes.data.id);
        if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
        // 人材側(cand_action_token)からの送信 → メモには「人材側」と明記。
        if (action === "話を進める" && meetingCandidates.length) await recordMeetingMemo(admin, candRes.data.id, meetingCandidates, "人材側");
        return NextResponse.json({ ok: true, side: "cand", action });
    }

    await logRespondError("POST", "invalid token (not found in proposals)", { token, action });
    return NextResponse.json({ ok: false, error: "invalid token" }, { status: 404 });
}

// token から proposal 情報を取得（公開ページ用）
export async function GET(req: NextRequest) {
    const token = req.nextUrl.searchParams.get("token");
    if (!token) return NextResponse.json({ ok: false, error: "missing token" }, { status: 400 });

    let admin: ReturnType<typeof engerAdmin>;
    try { admin = engerAdmin(); } catch {
        return NextResponse.json({ ok: false, error: "server config error" }, { status: 500 });
    }

    const jobRes = await admin.from("proposals")
        .select("id, job_title, company, c_init, job_action_type")
        .eq("job_action_token", token)
        .maybeSingle();

    if (jobRes.data) {
        return NextResponse.json({
            ok: true, side: "job",
            job_title: jobRes.data.job_title,
            company: jobRes.data.company,
            c_init: jobRes.data.c_init,
            current_action: jobRes.data.job_action_type,
        });
    }

    const candRes = await admin.from("proposals")
        .select("id, job_title, company, c_init, cand_action_type")
        .eq("cand_action_token", token)
        .maybeSingle();

    if (candRes.data) {
        return NextResponse.json({
            ok: true, side: "cand",
            job_title: candRes.data.job_title,
            company: candRes.data.company,
            c_init: candRes.data.c_init,
            current_action: candRes.data.cand_action_type,
        });
    }

    await logRespondError("GET", "invalid token (not found in proposals)", { token, action: null });
    return NextResponse.json({ ok: false, error: "invalid token" }, { status: 404 });
}
