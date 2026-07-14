"use client";

// 人材詳細（ドロワー／プロフィール詳細）の編集フォーム。#325①
//   ・カンマ／改行区切りで手入力し、保存で candidates の該当列に反映する。
//   ・フリーランス→人材マスタ登録の取り込みで入った初期値がここに表示され、追記・修正できる。
//   ・保存は既存の updateCandidateById を使う（列未整備の環境ではその列を除いて反映される）。
// #387①③：variant で編集対象を切り替える。
//   ・"industries"（人材詳細の「スキル・ツール」ブロック用）… 経験業種＋ツール。
//     スキルタグの編集はここから外す（スキル詳細＝本人登録・ドロワーの「スキル詳細」で扱うため）。
//   ・"skills"（人材一覧ドロワー用・既定）… スキル（ラベルは「スキル詳細」に変更可）＋ツール。
//     ここで保存した内容は candidates.skills なので、人材詳細のスキルタグ表示とも連動する。
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/toast";
import { updateCandidateById } from "@/lib/actions";

// カンマ・読点・改行・タブ区切り → 配列（前後空白除去・空要素と重複を除去）。
const parseList = (s: string): string[] => Array.from(new Set(s.split(/[\n,、\t]+/).map((x) => x.trim()).filter(Boolean)));

export function CandidateSkillsToolsEditor({ candidateNo, initialSkills, initialTools, initialIndustries = "", variant = "skills", skillsLabel = "スキル" }: {
  candidateNo: number;
  initialSkills: string[];
  initialTools: string[];
  initialIndustries?: string;   // #387①：経験業種（「業種（年数）」カンマ区切りテキスト）
  variant?: "skills" | "industries";
  skillsLabel?: string;         // #387③：ドロワーでは「スキル詳細」と表示
}) {
  const [skills, setSkills] = useState((initialSkills ?? []).join(", "));
  const [industries, setIndustries] = useState(initialIndustries ?? "");
  const [tools, setTools] = useState((initialTools ?? []).join(", "));
  const [saved, setSaved] = useState({ skills: (initialSkills ?? []).join(", "), industries: initialIndustries ?? "", tools: (initialTools ?? []).join(", ") });
  const [pending, start] = useTransition();
  const router = useRouter();
  const dirty = skills !== saved.skills || tools !== saved.tools || industries !== saved.industries;

  const save = () => {
    start(async () => {
      const fields: Record<string, unknown> = { tools: parseList(tools) };
      if (variant === "industries") fields.industries = industries.trim() || null;   // #387①：スキルの紐づけはこのブロックから解除
      else fields.skills = parseList(skills);
      const r = await updateCandidateById(candidateNo, fields as any);
      if (!r.ok) { toast(("error" in r ? r.error : null) || "保存に失敗しました", "error"); return; }
      setSaved({ skills, industries, tools });
      toast(variant === "industries" ? "経験業種・ツールを保存しました" : "スキル・ツールを保存しました", "success");
      router.refresh();
    });
  };

  const ta = { fontFamily: "inherit", fontSize: 12.5, lineHeight: 1.7, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)", resize: "vertical" as const, width: "100%", boxSizing: "border-box" as const };
  const lbl = { fontSize: 11, color: "var(--color-ink-4)", fontWeight: 600, marginBottom: 5 } as const;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
        {variant === "industries" ? (
          <div>
            {/* #387①：旧「スキル」欄。経験業種に変更（スキルはスキル詳細側で管理）。 */}
            <div style={lbl}>経験業種</div>
            <textarea value={industries} onChange={(e) => setIndustries(e.target.value)} rows={3} placeholder="金融業（3〜5年）, ゲーム業界（カンマ／改行区切り）" style={ta} />
          </div>
        ) : (
          <div>
            <div style={lbl}>{skillsLabel}</div>
            <textarea value={skills} onChange={(e) => setSkills(e.target.value)} rows={3} placeholder="React, TypeScript, AWS（カンマ／改行区切り）" style={ta} />
          </div>
        )}
        <div>
          <div style={lbl}>使用経験のあるツール・開発環境</div>
          <textarea value={tools} onChange={(e) => setTools(e.target.value)} rows={3} placeholder="VSCode, Docker, GitHub Actions（カンマ／改行区切り）" style={ta} />
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button type="button" className="btn btn-xs" disabled={!dirty || pending} onClick={save}
          style={dirty ? { background: "var(--color-brand-600)", borderColor: "var(--color-brand-600)", color: "#fff" } : undefined}>
          {pending ? "保存中…" : variant === "industries" ? "経験業種・ツールを保存" : "スキル・ツールを保存"}
        </button>
        {dirty && !pending && <span className="muted" style={{ fontSize: 11 }}>未保存の変更があります</span>}
      </div>
    </div>
  );
}
