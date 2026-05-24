"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveCompanyProfile, draftCompanyProfileFromUrl } from "@/app/portal/actions";

export type CompanyProfile = {
  mission: string; culture: string; ideal_persona: string; appeal: string; website: string;
};

export function CompanyProfileForm({ initial }: { initial: CompanyProfile }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [f, setF] = useState(initial);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [aiPending, startAi] = useTransition();
  const [aiMsg, setAiMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (k: keyof CompanyProfile, v: string) => setF((p) => ({ ...p, [k]: v }));

  const autoFill = () => {
    if (!f.website.trim()) { setAiMsg({ ok: false, text: "会社サイトURLを入力してください" }); return; }
    setAiMsg(null);
    startAi(async () => {
      const res = await draftCompanyProfileFromUrl(f.website);
      if (!res.ok || !res.draft) { setAiMsg({ ok: false, text: res.error || "生成に失敗しました" }); return; }
      const d = res.draft;
      setF((p) => ({
        ...p,
        mission: d.mission || p.mission,
        culture: d.culture || p.culture,
        ideal_persona: d.ideal_persona || p.ideal_persona,
        appeal: d.appeal || p.appeal,
      }));
      setAiMsg({ ok: true, text: "AIが下書きを入力しました。内容を確認・修正して保存してください。" });
    });
  };

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
      {/* URL → AI 自動入力 */}
      <div style={{ background: "var(--color-brand-25)", border: "1px solid var(--color-brand-100)", borderRadius: 12, padding: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: "var(--color-brand-800)", display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>auto_awesome</span>会社サイトURLから自動入力
        </div>
        <div style={{ fontSize: 11.5, color: "var(--color-ink-3)", marginBottom: 8 }}>会社のホームページURLを貼って「AIで下書き」を押すと、下の項目をAIが自動で埋めます（内容は確認・修正できます）。</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input style={{ ...inp, flex: "1 1 260px" }} type="url" value={f.website} onChange={(e) => set("website", e.target.value)} placeholder="https://your-company.co.jp" />
          <button className="btn brand" disabled={aiPending} onClick={autoFill} style={{ whiteSpace: "nowrap" }}>{aiPending ? "生成中…" : "AIで下書き"}</button>
        </div>
        {aiMsg && <div style={{ fontSize: 12, marginTop: 8, color: aiMsg.ok ? "var(--color-brand-700)" : "#b42318" }}>{aiMsg.text}</div>}
      </div>

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
      {msg && <div style={{ fontSize: 12.5, color: msg.ok ? "var(--color-brand-700)" : "#b42318" }}>{msg.text}</div>}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button className="btn brand" disabled={pending} onClick={save}>{pending ? "保存中…" : "保存する"}</button>
      </div>
    </div>
  );
}
