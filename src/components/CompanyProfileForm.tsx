"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveCompanyProfile } from "@/app/portal/actions";

export type CompanyProfile = {
  mission: string; culture: string; ideal_persona: string; appeal: string; website: string;
};

export function CompanyProfileForm({ initial }: { initial: CompanyProfile }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [f, setF] = useState(initial);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (k: keyof CompanyProfile, v: string) => setF((p) => ({ ...p, [k]: v }));

  const save = () => {
    setMsg(null);
    start(async () => {
      const res = await saveCompanyProfile(f);
      if (res.ok) { setMsg({ ok: true, text: "保存しました。" }); router.refresh(); }
      else setMsg({ ok: false, text: res.error || "保存に失敗しました" });
    });
  };

  const lbl = { fontSize: 13, fontWeight: 700, color: "var(--color-ink-2)", marginBottom: 5, display: "block" } as const;
  const hint = { fontSize: 11.5, color: "var(--color-ink-4)", marginBottom: 7 } as const;
  const ta = { width: "100%", padding: "10px 12px", border: "1px solid var(--color-border)", borderRadius: 9, fontSize: 13.5, fontFamily: "inherit", background: "#fff", outline: "none", resize: "vertical" as const };
  const inp = { ...ta, resize: "none" as const } as const;

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 760 }}>
      <div>
        <label style={lbl}>ミッション・事業の目的</label>
        <div style={hint}>何のために事業をしているか。共感する人材が集まり、定着・活躍につながります。</div>
        <textarea style={ta} rows={3} value={f.mission} onChange={(e) => set("mission", e.target.value)} placeholder="例：テクノロジーで地域の物流を変え、働く人の負担をゼロに近づける。" />
      </div>
      <div>
        <label style={lbl}>カルチャー・働き方・バリュー</label>
        <div style={hint}>大切にしている価値観、チームの雰囲気、働き方（リモート可否・裁量など）。</div>
        <textarea style={ta} rows={3} value={f.culture} onChange={(e) => set("culture", e.target.value)} placeholder="例：少人数・裁量大。フルリモート可。コードレビュー文化、学習支援あり。" />
      </div>
      <div>
        <label style={lbl}>求める人物像</label>
        <div style={hint}>スキルだけでなく、方向性・志向で合う人を言語化。マッチングの精度が上がります。</div>
        <textarea style={ta} rows={3} value={f.ideal_persona} onChange={(e) => set("ideal_persona", e.target.value)} placeholder="例：自走できる方。プロダクト志向で、ユーザー価値から逆算して動ける方。" />
      </div>
      <div>
        <label style={lbl}>自社の魅力・アピール</label>
        <div style={hint}>候補者に伝えたい強み（技術スタック、成長環境、待遇、実績など）。</div>
        <textarea style={ta} rows={2} value={f.appeal} onChange={(e) => set("appeal", e.target.value)} placeholder="例：モダンな技術スタック、上場準備フェーズ、ストックオプションあり。" />
      </div>
      <div style={{ maxWidth: 420 }}>
        <label style={lbl}>会社サイトURL</label>
        <input style={inp} type="url" value={f.website} onChange={(e) => set("website", e.target.value)} placeholder="https://…" />
      </div>

      {msg && <div style={{ fontSize: 12.5, color: msg.ok ? "var(--color-brand-700)" : "#b42318" }}>{msg.text}</div>}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button className="btn brand" disabled={pending} onClick={save}>{pending ? "保存中…" : "保存する"}</button>
      </div>
    </div>
  );
}
