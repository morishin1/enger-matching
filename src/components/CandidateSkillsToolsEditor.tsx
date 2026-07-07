"use client";

// 人材詳細（ドロワー／プロフィール詳細）の「スキル」「使用経験のあるツール・開発環境」編集フォーム。#325①
//   ・どちらもカンマ／改行区切りで手入力し、保存で candidates.skills / candidates.tools に反映する。
//   ・フリーランス→人材マスタ登録の取り込みで入った初期値がここに表示され、追記・修正できる。
//   ・保存は既存の updateCandidateById を使う（tools 列が未整備の環境では skills のみ反映される）。
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/toast";
import { updateCandidateById } from "@/lib/actions";

// カンマ・読点・改行・タブ区切り → 配列（前後空白除去・空要素と重複を除去）。
const parseList = (s: string): string[] => Array.from(new Set(s.split(/[\n,、\t]+/).map((x) => x.trim()).filter(Boolean)));

export function CandidateSkillsToolsEditor({ candidateNo, initialSkills, initialTools }: { candidateNo: number; initialSkills: string[]; initialTools: string[] }) {
  const [skills, setSkills] = useState((initialSkills ?? []).join(", "));
  const [tools, setTools] = useState((initialTools ?? []).join(", "));
  const [saved, setSaved] = useState({ skills: (initialSkills ?? []).join(", "), tools: (initialTools ?? []).join(", ") });
  const [pending, start] = useTransition();
  const router = useRouter();
  const dirty = skills !== saved.skills || tools !== saved.tools;

  const save = () => {
    start(async () => {
      const r = await updateCandidateById(candidateNo, { skills: parseList(skills), tools: parseList(tools) } as any);
      if (!r.ok) { toast(("error" in r ? r.error : null) || "保存に失敗しました", "error"); return; }
      setSaved({ skills, tools });
      toast("スキル・ツールを保存しました", "success");
      router.refresh();
    });
  };

  const ta = { fontFamily: "inherit", fontSize: 12.5, lineHeight: 1.7, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)", resize: "vertical" as const, width: "100%", boxSizing: "border-box" as const };
  const lbl = { fontSize: 11, color: "var(--color-ink-4)", fontWeight: 600, marginBottom: 5 } as const;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
        <div>
          <div style={lbl}>スキル</div>
          <textarea value={skills} onChange={(e) => setSkills(e.target.value)} rows={3} placeholder="React, TypeScript, AWS（カンマ／改行区切り）" style={ta} />
        </div>
        <div>
          <div style={lbl}>使用経験のあるツール・開発環境</div>
          <textarea value={tools} onChange={(e) => setTools(e.target.value)} rows={3} placeholder="VSCode, Docker, GitHub Actions（カンマ／改行区切り）" style={ta} />
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button type="button" className="btn btn-xs" disabled={!dirty || pending} onClick={save}
          style={dirty ? { background: "var(--color-brand-600)", borderColor: "var(--color-brand-600)", color: "#fff" } : undefined}>
          {pending ? "保存中…" : "スキル・ツールを保存"}
        </button>
        {dirty && !pending && <span className="muted" style={{ fontSize: 11 }}>未保存の変更があります</span>}
      </div>
    </div>
  );
}
