"use client";

import { useEffect, useState, useTransition } from "react";
import { draftCandidateReferralSmart, submitCandidateReferral, listMyCandidateReferrals } from "@/app/portal/actions";
import { REFERRAL_STATUS_LABEL, REFERRAL_STATUS_TONE, type ClientReferral } from "@/lib/client-referrals";

// docs/business-dashboard-v2-仕様.md §4「エージェントに紹介（モーダル）」。
//   「人材を登録」ではなく「エージェントに紹介」＝内容をエージェントが確認してから人材登録する。
//   候補者・応募者ページ／自社案件ページのヘッダーから開く共通ボタン＋モーダル。

const EMPTY = { name: "", initials: "", title: "", skillsText: "", rate: "", exp: "", avail: "", location: "", note: "" };

export function AgentReferralButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn brand" onClick={() => setOpen(true)} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>person_add</span>エージェントに紹介
      </button>
      {open && <ReferralModal onClose={() => setOpen(false)} />}
    </>
  );
}

function ReferralModal({ onClose }: { onClose: () => void }) {
  const [f, setF] = useState(EMPTY);
  const [aiText, setAiText] = useState("");
  const [aiPending, startAi] = useTransition();
  const [aiMsg, setAiMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [history, setHistory] = useState<ClientReferral[] | null>(null);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    listMyCandidateReferrals().then(setHistory).catch(() => setHistory([]));
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", onKey); };
  }, [onClose]);

  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  const autoFill = () => {
    if (aiText.trim().length < 20) { setAiMsg({ ok: false, text: "経歴テキストを20文字以上で貼り付けてください" }); return; }
    setAiMsg(null);
    startAi(async () => {
      const res = await draftCandidateReferralSmart(aiText);
      if (!res.ok || !res.draft) { setAiMsg({ ok: false, text: res.error || "生成に失敗しました" }); return; }
      const d = res.draft;
      setF((p) => ({
        ...p,
        initials: d.initials || p.initials,
        title: d.title || p.title,
        skillsText: (d.skills && d.skills.length > 0) ? d.skills.join(", ") : p.skillsText,
        rate: d.rate || p.rate,
        exp: d.exp || p.exp,
        avail: d.avail || p.avail,
        location: d.location || p.location,
        note: d.note || p.note,
      }));
      setAiMsg({ ok: true, text: "AIが下書きを入力しました。内容を確認・修正して送信してください。" });
    });
  };

  const submit = () => {
    setMsg(null);
    const skills = f.skillsText.split(/[、,\s]+/).map((s) => s.trim()).filter(Boolean);
    start(async () => {
      const res = await submitCandidateReferral({
        name: f.name, initials: f.initials, title: f.title, skills,
        rate: f.rate, exp: f.exp, avail: f.avail, location: f.location, note: f.note,
      });
      if (!res.ok) { setMsg({ ok: false, text: res.error || "送信に失敗しました" }); return; }
      setF(EMPTY); setAiText("");
      setMsg({ ok: true, text: "担当エージェントが内容を確認し、マッチする案件をおさがしします。" });
      listMyCandidateReferrals().then(setHistory).catch(() => {});
    });
  };

  const inp = { width: "100%", padding: "9px 11px", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 13, fontFamily: "inherit", background: "var(--color-surface)", color: "var(--color-ink)", outline: "none" } as const;
  const lbl = { fontSize: 12, fontWeight: 700, color: "var(--color-ink-2)", marginBottom: 4, display: "block" } as const;

  return (
    <div role="dialog" aria-modal="true" aria-label="エージェントに紹介"
      style={{ position: "fixed", inset: 0, zIndex: 80, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={onClose} aria-hidden style={{ position: "absolute", inset: 0, background: "rgba(8,15,30,.42)" }} />
      <div style={{ position: "relative", width: "min(560px, 100%)", maxHeight: "min(88vh, 900px)", background: "var(--color-surface)", borderRadius: 14, boxShadow: "0 24px 60px rgba(0,0,0,.24)", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--color-border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 15.5, fontWeight: 800 }}>エージェントに紹介</div>
            <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>自社の人材をエージェントへ紹介します。内容確認のうえ人材登録します（人材マスタへの直接登録ではありません）。</div>
          </div>
          <button onClick={onClose} aria-label="閉じる" title="閉じる" style={{ flex: "0 0 auto", background: "transparent", border: 0, cursor: "pointer", color: "var(--color-ink-4)" }}>
            <span className="material-symbols-outlined" style={{ fontSize: 22 }}>close</span>
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
          {/* AI下書き */}
          <div style={{ background: "var(--color-brand-25)", border: "1px solid var(--color-brand-100)", borderRadius: 12, padding: 12 }}>
            <div style={{ fontSize: 12.5, fontWeight: 800, color: "var(--color-brand-800)", display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 17 }}>auto_awesome</span>経歴テキストから自動入力
            </div>
            <textarea value={aiText} onChange={(e) => setAiText(e.target.value)} rows={3}
              placeholder="スキルシートの概要・経歴テキストを貼り付け（20文字以上）"
              style={{ ...inp, resize: "vertical" }} />
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
              <button className="btn brand" type="button" disabled={aiPending} onClick={autoFill}>{aiPending ? "生成中…" : "AIで下書き"}</button>
            </div>
            {aiMsg && <div style={{ fontSize: 11.5, marginTop: 6, color: aiMsg.ok ? "var(--color-brand-700)" : "#b42318" }}>{aiMsg.text}</div>}
          </div>

          {/* 入力フォーム */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div><label style={lbl}>氏名（社内管理用・任意）</label><input style={inp} value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="未入力ならイニシャルで登録" /></div>
            <div><label style={lbl}>イニシャル <span style={{ color: "#dc2626" }}>*</span></label><input style={inp} value={f.initials} onChange={(e) => set("initials", e.target.value)} placeholder="例：T.Y" maxLength={8} /></div>
            <div><label style={lbl}>職種</label><input style={inp} value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="例：バックエンドエンジニア" /></div>
            <div><label style={lbl}>希望単価</label><input style={inp} value={f.rate} onChange={(e) => set("rate", e.target.value)} placeholder="例：〜80万" /></div>
            <div><label style={lbl}>経験年数</label><input style={inp} value={f.exp} onChange={(e) => set("exp", e.target.value)} placeholder="例：5" /></div>
            <div><label style={lbl}>稼働開始</label><input style={inp} value={f.avail} onChange={(e) => set("avail", e.target.value)} placeholder="例：即日 / 1ヶ月後" /></div>
            <div><label style={lbl}>最寄駅</label><input style={inp} value={f.location} onChange={(e) => set("location", e.target.value)} placeholder="例：渋谷" /></div>
            <div style={{ gridColumn: "1 / -1" }}><label style={lbl}>スキル（カンマ区切り） <span style={{ color: "#dc2626" }}>*</span></label><input style={inp} value={f.skillsText} onChange={(e) => set("skillsText", e.target.value)} placeholder="React, TypeScript, AWS" /></div>
            <div style={{ gridColumn: "1 / -1" }}><label style={lbl}>備考</label><textarea style={{ ...inp, resize: "vertical" }} rows={2} value={f.note} onChange={(e) => set("note", e.target.value)} placeholder="並行状況・商流・面談可能日など" /></div>
          </div>

          {msg && <div style={{ fontSize: 12.5, color: msg.ok ? "var(--color-brand-700)" : "#b42318" }}>{msg.text}</div>}
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button className="btn brand" disabled={pending} onClick={submit}>{pending ? "送信中…" : "紹介する"}</button>
          </div>

          {/* 紹介履歴＋対応状況 */}
          <div style={{ borderTop: "1px solid var(--color-border)", paddingTop: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: "var(--color-ink-3)", marginBottom: 8 }}>紹介履歴</div>
            {history == null ? (
              <div className="muted" style={{ fontSize: 12 }}>読み込み中…</div>
            ) : history.length === 0 ? (
              <div className="muted" style={{ fontSize: 12 }}>まだ紹介はありません。</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {history.slice(0, 10).map((r) => (
                  <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, padding: "6px 0", borderBottom: "1px solid var(--color-border)" }}>
                    <span style={{ fontWeight: 700, flex: "0 0 auto" }}>{r.initials || "—"}</span>
                    <span className="muted" style={{ flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title || "職種未設定"}</span>
                    <span style={{ flex: "0 0 auto", fontSize: 10.5, fontWeight: 800, padding: "2px 9px", borderRadius: 99, color: "#fff", background: REFERRAL_STATUS_TONE[r.status] }}>{REFERRAL_STATUS_LABEL[r.status]}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
