"use client";

import { useEffect, useState } from "react";

type ProposalInfo = {
    side: "job" | "cand";
    job_title: string | null;
    company: string | null;
    c_init: string | null;
    current_action: string;
};

const ACTION_LABEL: Record<string, string> = {
    "話を進める": "話を進める（承認）",
    "見送り": "見送り（辞退）",
};

const ACTION_COLOR: Record<string, { bg: string; border: string; text: string }> = {
    "話を進める": { bg: "#16a34a", border: "#15803d", text: "#fff" },
    "見送り":     { bg: "#dc2626", border: "#b91c1c", text: "#fff" },
};

const DONE_COLOR: Record<string, { bg: string; text: string }> = {
    "話を進める": { bg: "#dcfce7", text: "#15803d" },
    "見送り":     { bg: "#fee2e2", text: "#b91c1c" },
    "未回答":     { bg: "#f1f5f9", text: "#64748b" },
};

export function RespondClient({ token, action }: { token: string; action: string }) {
    const [info, setInfo] = useState<ProposalInfo | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [confirming, setConfirming] = useState(false);
    const [done, setDone] = useState(false);
    const [doneAction, setDoneAction] = useState<string>("");

    const isValidAction = action === "話を進める" || action === "見送り";

    useEffect(() => {
        if (!token) { setError("URLが無効です。"); setLoading(false); return; }
        fetch(`/api/respond?token=${encodeURIComponent(token)}`)
            .then((r) => r.json())
            .then((d) => {
                if (!d.ok) { setError("URLが無効か期限切れです。"); return; }
                setInfo(d);
                if (d.current_action !== "未回答") { setDone(true); setDoneAction(d.current_action); }
            })
            .catch(() => setError("データの取得に失敗しました。"))
            .finally(() => setLoading(false));
    }, [token]);

    const handleConfirm = async () => {
        if (!isValidAction || confirming) return;
        setConfirming(true);
        try {
            const res = await fetch("/api/respond", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token, action }),
            });
            const d = await res.json();
            if (d.ok) { setDone(true); setDoneAction(action); }
            else if (d.error === "already_answered") { setDone(true); setDoneAction(d.current); }
            else setError("送信に失敗しました。しばらく経ってから再度お試しください。");
        } catch { setError("送信に失敗しました。"); }
        finally { setConfirming(false); }
    };

    const containerStyle: React.CSSProperties = {
        minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
        background: "#f8fafc", padding: 24,
    };
    const cardStyle: React.CSSProperties = {
        background: "#fff", borderRadius: 16, boxShadow: "0 4px 24px rgba(15,23,42,.10)",
        padding: "40px 36px", maxWidth: 480, width: "100%", textAlign: "center",
    };

    if (loading) return (
        <div style={containerStyle}>
            <div style={cardStyle}>
                <div style={{ color: "#94a3b8", fontSize: 14 }}>読み込み中…</div>
            </div>
        </div>
    );

    if (error) return (
        <div style={containerStyle}>
            <div style={cardStyle}>
                <div style={{ fontSize: 36, marginBottom: 16 }}>⚠️</div>
                <div style={{ fontSize: 15, color: "#dc2626", fontWeight: 600 }}>{error}</div>
                <div style={{ fontSize: 13, color: "#94a3b8", marginTop: 8 }}>URLをご確認いただくか、担当者にお問い合わせください。</div>
            </div>
        </div>
    );

    if (done) {
        const tone = DONE_COLOR[doneAction] ?? DONE_COLOR["未回答"];
        return (
            <div style={containerStyle}>
                <div style={cardStyle}>
                    <div style={{ fontSize: 36, marginBottom: 16 }}>✅</div>
                    <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>ご回答ありがとうございます</div>
                    <div style={{ display: "inline-block", padding: "8px 20px", borderRadius: 99, background: tone.bg, color: tone.text, fontWeight: 700, fontSize: 15, marginBottom: 16 }}>
                        {doneAction}
                    </div>
                    <div style={{ fontSize: 13, color: "#64748b" }}>
                        担当者に通知されました。<br />このページは閉じていただいて構いません。
                    </div>
                </div>
            </div>
        );
    }

    if (!isValidAction) return (
        <div style={containerStyle}>
            <div style={cardStyle}>
                <div style={{ fontSize: 36, marginBottom: 16 }}>⚠️</div>
                <div style={{ fontSize: 15, color: "#dc2626", fontWeight: 600 }}>URLのパラメータが無効です。</div>
            </div>
        </div>
    );

    const tone = ACTION_COLOR[action];
    const sideLabel = info?.side === "job" ? "企業様" : "候補者様";

    return (
        <div style={containerStyle}>
            <div style={cardStyle}>
                <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 6 }}>ご確認のお願い</div>
                <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 20, color: "#0f172a" }}>
                    以下の内容でよろしいですか？
                </div>

                {/* 案件情報 */}
                <div style={{ background: "#f8fafc", borderRadius: 10, padding: "16px 20px", marginBottom: 24, textAlign: "left" }}>
                    <div style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600, marginBottom: 4 }}>案件</div>
                    <div style={{ fontWeight: 700, fontSize: 14, color: "#1e293b" }}>{info?.job_title ?? "—"}</div>
                    <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>{info?.company ?? ""}</div>
                    {info?.c_init && (
                        <>
                            <div style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600, marginTop: 12, marginBottom: 4 }}>候補者</div>
                            <div style={{ fontWeight: 700, fontSize: 14 }}>{info.c_init}</div>
                        </>
                    )}
                </div>

                {/* 選択アクション */}
                <div style={{ fontSize: 13, color: "#64748b", marginBottom: 12 }}>
                    {sideLabel}のご回答：
                </div>
                <div style={{
                    display: "inline-block", padding: "10px 28px", borderRadius: 99,
                    background: tone.bg + "22", color: tone.bg, fontWeight: 800, fontSize: 17,
                    border: `2px solid ${tone.bg}55`, marginBottom: 28,
                }}>
                    {ACTION_LABEL[action]}
                </div>

                <button
                    onClick={handleConfirm}
                    disabled={confirming}
                    style={{
                        display: "block", width: "100%", padding: "14px 0",
                        borderRadius: 10, border: "none", cursor: confirming ? "wait" : "pointer",
                        background: tone.bg, color: tone.text, fontSize: 16, fontWeight: 700,
                        opacity: confirming ? 0.7 : 1, transition: "opacity .15s",
                    }}
                >
                    {confirming ? "送信中…" : "確認して送信する"}
                </button>

                <div style={{ fontSize: 11.5, color: "#94a3b8", marginTop: 16 }}>
                    送信後はキャンセルできません。
                </div>
            </div>
        </div>
    );
}
