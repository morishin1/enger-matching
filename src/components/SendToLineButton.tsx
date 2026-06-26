"use client";

// マッチング画面の「LINEに送る」ボタン。
//   選択中の 1組（人材 × 案件）を、記憶済みの LINE WORKS トークへ送る。
//   宛先は webhook で記憶した送信先(lineworks_targets)から選ぶ。
import { useState } from "react";
import type { LineworksTarget } from "@/lib/lineworks-targets";
import { sendMatchToLineworks } from "@/app/matching/lineworks-actions";

type Props = {
  targets: LineworksTarget[];
  candidateName: string;
  jobTitle: string;
  personNo?: number | null;
  jobNo?: number | null;
  score?: number | null;
  matchedSkills?: string[];
};

const fmtSeen = (s: string) => {
  const d = new Date(s);
  if (isNaN(d.getTime())) return "";
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
const targetLabel = (t: LineworksTarget) =>
  t.name?.trim() || (t.last_text ? `「${t.last_text.slice(0, 18)}…」` : `${t.kind === "channel" ? "グループ" : "1:1"} ${t.target_id.slice(-6)}`);

export function SendToLineButton(props: Props) {
  const { targets } = props;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const send = (t: LineworksTarget) => {
    setBusy(t.id);
    setMsg(null);
    sendMatchToLineworks({
      kind: t.kind,
      targetId: t.target_id,
      candidateName: props.candidateName,
      jobTitle: props.jobTitle,
      personNo: props.personNo ?? null,
      jobNo: props.jobNo ?? null,
      score: props.score ?? null,
      matchedSkills: props.matchedSkills ?? [],
    }).then((res) => {
      setBusy(null);
      if (res.ok) {
        setMsg({ ok: true, text: `✓ ${targetLabel(t)} に送信しました` });
        setOpen(false);
      } else {
        setMsg({ ok: false, text: res.error || "送信に失敗しました" });
      }
    });
  };

  return (
    <div style={{ position: "relative", display: "inline-flex", flexDirection: "column", alignItems: "flex-end" }}>
      <button
        type="button"
        className="btn ghost"
        onClick={() => setOpen((v) => !v)}
        title="この人材×案件のマッチを LINE WORKS のトークに送る"
        style={{ display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 18, lineHeight: 1 }}>send</span>
        LINEに送る
      </button>

      {open && (
        <div
          style={{
            position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 60, width: 260,
            background: "var(--color-surface)", border: "1px solid var(--color-border-strong)", borderRadius: 10,
            boxShadow: "0 8px 24px rgba(15,23,42,.14)", padding: 8,
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--color-ink-4)", padding: "4px 6px 6px" }}>送信先のトークを選択</div>
          {targets.length === 0 ? (
            <div style={{ fontSize: 11.5, color: "var(--color-ink-3)", lineHeight: 1.6, padding: "4px 6px 8px" }}>
              送信先がまだありません。<br />
              LINE WORKS で <b>Bot のいるトークに一度何か投稿</b>すると、ここに宛先として表示されます。
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: 240, overflowY: "auto" }}>
              {targets.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  disabled={!!busy}
                  onClick={() => send(t)}
                  style={{
                    display: "flex", flexDirection: "column", gap: 2, textAlign: "left", width: "100%",
                    padding: "7px 8px", borderRadius: 8, border: "1px solid transparent", background: "transparent",
                    cursor: busy ? "wait" : "pointer", opacity: busy && busy !== t.id ? 0.5 : 1,
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-surface-inset)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--color-ink)" }}>
                    {busy === t.id ? "送信中…" : targetLabel(t)}
                  </span>
                  <span style={{ fontSize: 10.5, color: "var(--color-ink-4)" }}>
                    {t.kind === "channel" ? "グループ" : "1:1"} · 最終 {fmtSeen(t.last_seen_at)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {msg && (
        <span style={{ fontSize: 11, marginTop: 4, color: msg.ok ? "#067647" : "var(--color-danger)", whiteSpace: "nowrap" }}>{msg.text}</span>
      )}
    </div>
  );
}
