"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { expressTalentInterest } from "@/app/portal/actions";

export type PortalTalent = {
  ref: string;
  kind: "candidate" | "profile";
  initials: string;
  title: string | null;
  skills: string[];
  matchedSkills: string[];
  rate: string;
  matchPct: number;
  requested: boolean;
};

export function PortalTalentList({ talent }: { talent: PortalTalent[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);

  if (talent.length === 0) {
    return <div className="card" style={{ fontSize: 13, color: "var(--color-ink-3)" }}>現在、貴社案件にマッチするおすすめ人材がありません。案件の掲載・スキル要件の追加で精度が上がります。</div>;
  }

  const request = (t: PortalTalent) => {
    setBusy(t.ref);
    start(async () => {
      const res = await expressTalentInterest({ kind: t.kind, ref: t.ref, label: `${t.initials}・${t.title ?? ""}` });
      setBusy(null);
      if (res.ok) { setDone((d) => ({ ...d, [t.ref]: true })); router.refresh(); }
      else alert(res.error || "送信に失敗しました");
    });
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
      {talent.map((t) => {
        const requested = t.requested || done[t.ref];
        return (
          <div key={t.ref} className="card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <div className="ava" style={{ width: 42, height: 42, flex: "0 0 42px" }}>{t.initials}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title || "エンジニア"}</div>
                <div className="muted" style={{ fontSize: 11 }}>{t.kind === "profile" ? "ENGER登録" : "登録人材"} · 想定 {t.rate}</div>
              </div>
              {t.matchPct > 0 && <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 800, padding: "3px 9px", borderRadius: 99, background: "var(--color-brand-600)", color: "#fff" }}>{t.matchPct}%</span>}
            </div>
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              {t.skills.slice(0, 6).map((s) => (
                <span key={s} className="tag" style={{ fontSize: 10.5, background: t.matchedSkills.includes(s) ? "var(--color-brand-100)" : "var(--color-brand-25)", color: "var(--color-brand-700)", fontWeight: t.matchedSkills.includes(s) ? 700 : 500 }}>{s}</span>
              ))}
            </div>
            <div style={{ marginTop: "auto", paddingTop: 8, borderTop: "1px solid var(--color-border)" }}>
              {requested ? (
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--color-brand-700)", textAlign: "center", padding: "8px 0" }}>✓ 担当より折り返しご連絡します</div>
              ) : (
                <button className="btn brand" style={{ width: "100%", justifyContent: "center" }} disabled={pending && busy === t.ref} onClick={() => request(t)}>
                  {pending && busy === t.ref ? "送信中…" : "話を聞きたい"}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
