"use client";

import { PROPOSERS } from "@/lib/proposal-constants";
import { reSubject } from "@/lib/gmail";

export type MailForm = { email: string; cc: string; subject: string; body: string };
export type MailErrors = { email?: string; cc?: string; subject?: string; body?: string };

const SIGNATURE = `∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞
株式会社エイト
ITS事業部
野澤：080-4191-4175
 Mail：support_eigyo@8grp.co.jp
エンジニア・PM・DX人材の即戦力マッチング：https://enger.jp/
インキュベーションスペース：https://8sp.jp/
 自社サイト：https://8grp.co.jp/
〒150-0001 東京都渋谷区神宮前6-33-14-エイトカフェ2F
∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞
「株式会社エイト」公式ホームページ
デキルがあふれる社会をつくる - 「株式会社エイト」公式ホームページ
異なるアイデアと先進技術を融合し、革新的なサービスを生み出す。コラボレーションとテクノロジーで、企業の課題解決と新たな価値創造を支援します。`;

export function buildJobMailSubject(job: any): string {
  return reSubject(job.title ?? "");
}

export function buildJobMailContent(job: any, cand: any): string {
  const remark = cand.note?.trim() || [
    `【 名　前 】${cand.name ?? ""}${cand.age_band ? `　(${cand.age_band})` : ""}`,
    cand.location ? `【最 寄 駅】${cand.location}` : "",
    cand.avail ? `【稼 動 日】${cand.avail}` : "",
    cand.affiliation ? `【所　 属】${cand.affiliation}` : "",
    `【単　 価】${cand.rate ?? "応相談"}`,
    `【ス キ ル】${Array.isArray(cand.skills) && cand.skills.length ? cand.skills.join("、") : "—"}`,
    cand.exp ? `【 実　績 】\n${cand.exp}` : "",
  ].filter(Boolean).join("\n");

  const skillSheet = cand.skill_sheet_url
    ? `\n━━━━━━━━━━━━━━━━━━━\nスキルシート：\n${cand.skill_sheet_url}\n`
    : "";

  return `${job.client_name ?? ""}
${job.contact_name ? `${job.contact_name} 様` : "ご担当者 様"}

いつも大変お世話になっております。
株式会社エイトの営業担当でございます。
ぜひご紹介したい要員がおりますので、ご提案いたします。
※要員にエントリー可否並行確認中です。
────────────────────────────────────
◆ご紹介していただいた案件
【案件名】：　${job.title ?? ""}
────────────────────────────────────
◆ご紹介する要員
${remark}${skillSheet}
────────────────────────────────────
■話を進める時のお願い
話を進めるのをご希望の際は、本メール内の
「話を進める」ボタンよりご回答くださいますようお願いいたします。
何卒よろしくお願い申し上げます。
${SIGNATURE}`;
}

const DOT_COLOR = "#ef4444";

const inputBase: React.CSSProperties = {
  fontFamily: "inherit", fontSize: 12.5, padding: "6px 9px", borderRadius: 8,
  border: "1px solid var(--color-border-strong)",
  background: "var(--color-surface)", color: "var(--color-ink)",
  width: "100%", boxSizing: "border-box",
};

const errText: React.CSSProperties = { fontSize: 11, color: "var(--color-danger)", marginTop: 2 };
const fieldLabel: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: "var(--color-ink-4)" };

export function JobMailBodyCard({
  form, errors, proposer, onProposerChange, onChange, badgeLabel,
}: {
  form: MailForm;
  errors: MailErrors;
  proposer: string;
  onProposerChange: (v: string) => void;
  onChange: (field: keyof MailForm, v: string) => void;
  badgeLabel: string;
}) {
  return (
    <div style={{ flex: 1, minWidth: 0, border: "1px solid var(--color-border)", borderRadius: 12, background: "var(--color-surface)", boxShadow: "0 1px 3px rgba(15,23,42,.06)", display: "flex", flexDirection: "column", height: "calc(100vh - 160px)", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: "1px solid var(--color-border)", background: "var(--color-surface-soft)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 12, height: 12, borderRadius: "50%", background: DOT_COLOR, flexShrink: 0 }} />
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--color-ink)" }}>案件側へのメール</span>
        </div>
        {badgeLabel && (
          <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 10px", borderRadius: 99, background: DOT_COLOR + "18", color: DOT_COLOR, border: `1px solid ${DOT_COLOR}44`, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {badgeLabel}
          </span>
        )}
      </div>

      {/* Fixed fields */}
      <div style={{ padding: "12px 16px", flexShrink: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        <label style={fieldLabel}>
          担当者
          <select value={proposer} onChange={(e) => onProposerChange(e.target.value)} style={inputBase}>
            <option value="">—</option>
            {PROPOSERS.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
        {/* <label style={fieldLabel}>
          宛先
          <input
            type="email" value={form.email} placeholder="job@example.com"
            onChange={(e) => onChange("email", e.target.value)}
            style={{ ...inputBase, borderColor: errors.email ? "var(--color-danger)" : "var(--color-border-strong)" }}
          />
          {errors.email && <div style={errText}>{errors.email}</div>}
        </label>
        <label style={fieldLabel}>
          Cc
          <input
            type="text" value={form.cc} placeholder="cc@example.com"
            onChange={(e) => onChange("cc", e.target.value)}
            style={{ ...inputBase, borderColor: errors.cc ? "var(--color-danger)" : "var(--color-border-strong)" }}
          />
          {errors.cc && <div style={errText}>{errors.cc}</div>}
        </label>
        <label style={fieldLabel}>
          件名
          <input
            type="text" value={form.subject} placeholder="件名"
            onChange={(e) => onChange("subject", e.target.value)}
            style={{ ...inputBase, borderColor: errors.subject ? "var(--color-danger)" : "var(--color-border-strong)" }}
          />
          {errors.subject && <div style={errText}>{errors.subject}</div>}
        </label> */}
      </div>

      {/* Body textarea — fills remaining space */}
      <div style={{ flex: 1, minHeight: 0, padding: "0 16px 16px", display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 11, color: "var(--color-ink-4)", flexShrink: 0 }}>本文</span>
        <textarea
          value={form.body}
          onChange={(e) => onChange("body", e.target.value)}
          style={{
            flex: 1, display: "block", width: "100%", boxSizing: "border-box",
            fontFamily: "inherit", fontSize: 13, lineHeight: 1.75,
            padding: "12px 14px", borderRadius: 8, resize: "none",
            border: `1px solid ${errors.body ? "var(--color-danger)" : "var(--color-border-strong)"}`,
            background: "var(--color-surface)", color: "var(--color-ink)",
            overflowY: "auto", minHeight: 0,
          }}
        />
        {errors.body && <div style={errText}>{errors.body}</div>}
      </div>
    </div>
  );
}
