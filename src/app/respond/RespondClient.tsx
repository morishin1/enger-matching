"use client";

import { useEffect, useState } from "react";
import { isWeekendOrJpHoliday } from "@/lib/jp-holidays";

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

// 面談希望時間の選択肢（30分単位）。
const TIME_OPTIONS = (() => {
    const arr: string[] = [];
    for (let h = 9; h <= 21; h++) {
        for (const m of [0, 30]) {
            if (h === 21 && m === 30) continue;
            arr.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
        }
    }
    return arr;
})();

// 今日から days 日後の日付を YYYY-MM-DD（ローカル）で返す。
function todayPlus(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() + days);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${dd}`;
}

export function RespondClient({ token, action }: { token: string; action: string }) {
    const [info, setInfo] = useState<ProposalInfo | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [confirming, setConfirming] = useState(false);
    const [done, setDone] = useState(false);
    const [doneAction, setDoneAction] = useState<string>("");
    const [slots, setSlots] = useState<{ date: string; time: string }[]>([
        { date: "", time: "" }, { date: "", time: "" }, { date: "", time: "" }, { date: "", time: "" },
    ]);
    // #259：土日祝は選択不可。選ばれた場合はクリアして注意を表示する。
    const [dateWarn, setDateWarn] = useState<string | null>(null);
    const pickDate = (i: number, value: string) => {
        if (value && isWeekendOrJpHoliday(value)) {
            setDateWarn("土日祝はご指定いただけません。平日の日付をお選びください。");
            setSlots((prev) => prev.map((p, j) => (j === i ? { ...p, date: "" } : p)));
            return;
        }
        setDateWarn(null);
        setSlots((prev) => prev.map((p, j) => (j === i ? { ...p, date: value } : p)));
    };

    const isValidAction = action === "話を進める" || action === "見送り";
    const isProceed = action === "話を進める";
    // 当日・翌日は選択不可（明後日＝2日後以降のみ）。
    const minDate = todayPlus(2);

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
            // 入力された希望日時のみ抽出（日付必須・時間は任意）。「2026/06/28 10:00」形式。
            const meetingCandidates = isProceed
                ? slots
                    .filter((s) => s.date)
                    .map((s) => `${s.date.replace(/-/g, "/")}${s.time ? ` ${s.time}` : ""}`)
                : [];
            const res = await fetch("/api/respond", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token, action, meetingCandidates }),
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
                <div style={{ fontSize: isProceed ? 16 : 20, fontWeight: 800, marginBottom: 20, color: "#0f172a", lineHeight: 1.5 }}>
                    {isProceed ? "面談ご希望をご選択後、送信してください" : "以下の内容でよろしいですか？"}
                </div>

                {/* 面談希望日時フォーム（任意・最大4件。当日/翌日は選択不可） */}
                {isProceed && (
                    <div style={{ marginBottom: 24, textAlign: "left" }}>
                        <div style={{ fontSize: 13, color: "#334155", fontWeight: 700, marginBottom: 4 }}>面談ご希望日時（任意・最大4件）</div>
                        <div style={{ fontSize: 11.5, color: "#94a3b8", marginBottom: 12, lineHeight: 1.6 }}>
                            ご希望があればご入力ください。未入力のままでも送信いただけます。<br />※ 土日祝はご指定いただけません（平日のみ）。
                        </div>
                        {dateWarn && <div style={{ fontSize: 12, color: "#b42318", background: "#fdecef", border: "1px solid #f7c5cf", borderRadius: 8, padding: "8px 10px", marginBottom: 10 }}>{dateWarn}</div>}
                        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                            {slots.map((s, i) => (
                                <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                    <span style={{ fontSize: 12, color: "#94a3b8", flex: "0 0 18px" }}>{i + 1}</span>
                                    <input
                                        type="date"
                                        min={minDate}
                                        value={s.date}
                                        onChange={(e) => pickDate(i, e.target.value)}
                                        style={{ flex: 1, minWidth: 0, padding: "10px 12px", border: "1px solid #d6dce5", borderRadius: 8, fontSize: 14, fontFamily: "inherit", background: "#fff", color: "#1e293b" }}
                                    />
                                    <select
                                        value={s.time}
                                        onChange={(e) => setSlots((prev) => prev.map((p, j) => (j === i ? { ...p, time: e.target.value } : p)))}
                                        style={{ flex: "0 0 96px", padding: "10px 8px", border: "1px solid #d6dce5", borderRadius: 8, fontSize: 14, fontFamily: "inherit", background: "#fff", color: "#1e293b" }}
                                    >
                                        <option value="">時間</option>
                                        {TIME_OPTIONS.map((t) => (
                                            <option key={t} value={t}>{t}</option>
                                        ))}
                                    </select>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

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
