import { NextRequest, NextResponse } from "next/server";
import { engerAdmin } from "@/lib/supabase";

const VALID_ACTIONS = ["話を進める", "見送り"] as const;
type ActionType = (typeof VALID_ACTIONS)[number];

export async function POST(req: NextRequest) {
    const { token, action } = await req.json().catch(() => ({}));
    if (!token || !VALID_ACTIONS.includes(action)) {
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
        return NextResponse.json({ ok: true, side: "cand", action });
    }

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

    return NextResponse.json({ ok: false, error: "invalid token" }, { status: 404 });
}
