"use client";

import { PROPOSERS, SHARED_MAILBOX } from "@/lib/proposal-constants";

import { BUTTON_PLACEHOLDER } from "./JobMailBodyCard";
import type { MailForm, MailErrors } from "./JobMailBodyCard";

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

const CAND_SUBJECT = "【案件のご紹介】希望条件に合致する案件のお知らせ";

export function buildCandMailSubject(): string {
  return CAND_SUBJECT;
}

export function buildCandMailContent(job: any, cand: any): string {
  const salary = (lo?: number | null, hi?: number | null) =>
    lo && hi ? (lo === hi ? `${lo}万円` : `${lo}〜${hi}万円`) : hi ? `〜${hi}万円` : lo ? `${lo}万円〜` : "スキル見合い";

  const candidateCompany = cand.source_company || cand.company || null;

  const greeting = cand.contact_name
    ? `${cand.contact_name} 様`
    : (candidateCompany ? "ご担当者 様" : `${cand.name ?? ""} 様`);

  const jobSummary = [
    `【案件】${job.title ?? ""}`,
    Array.isArray(job.skills) && job.skills.length ? `【スキル】${job.skills.join("、")}` : "",
    `【単金】${salary(job.salary_min, job.salary_max)}`,
    job.work_location ? `【場所】${job.work_location}` : "",
    job.start_date ? `【期間】${job.start_date}〜` : "",
    job.flow_note ? `【商流】${job.flow_note}` : "",
  ].filter(Boolean).join("\n");

  return `${candidateCompany ?? "〇〇"}
${greeting}

いつも大変お世話になっております。
株式会社エイトの営業担当でございます。
この度は要員様をご紹介いただき、誠にありがとうございます。
下記の案件をぜひご紹介させていただきたくご連絡いたしました。
ご確認のほど何卒よろしくお願い申し上げます。
────────────────────────────────────
◆ご紹介していただいた要員
${cand.name ?? ""}
${cand.age_band ? cand.age_band : ""}
${cand.location ? `【最寄駅】${cand.location}` : ""}
────────────────────────────────────
◆ご紹介する案件
${jobSummary}
────────────────────────────────────
${BUTTON_PLACEHOLDER}
${SIGNATURE}`;
}

const DOT_COLOR = "#3b82f6";

const inputBase: React.CSSProperties = {
  fontFamily: "inherit", fontSize: 12.5, padding: "6px 9px", borderRadius: 8,
  border: "1px solid var(--color-border-strong)",
  background: "var(--color-surface)", color: "var(--color-ink)",
  width: "100%", boxSizing: "border-box",
};

const errText: React.CSSProperties = { fontSize: 11, color: "var(--color-danger)", marginTop: 2 };
const fieldLabel: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: "var(--color-ink-4)" };

export function CandMailBodyCard({
  form, errors, proposer, onProposerChange, onChange, badgeLabel, origMailUrl, origMailBody,
}: {
  form: MailForm;
  errors: MailErrors;
  proposer: string;
  onProposerChange: (v: string) => void;
  onChange: (field: keyof MailForm, v: string) => void;
  badgeLabel: string;
  origMailUrl?: string | null;
  /** 取込元メール本文（あれば UI 内に全文プレビュー）。 */
  origMailBody?: string | null;
}) {
  return (
    <div style={{ flex: 1, minWidth: 0, border: "1px solid var(--color-border)", borderRadius: 12, background: "var(--color-surface)", boxShadow: "0 1px 3px rgba(15,23,42,.06)", display: "flex", flexDirection: "column", height: "calc(100vh - 160px)", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: "1px solid var(--color-border)", background: "var(--color-surface-soft)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 12, height: 12, borderRadius: "50%", background: DOT_COLOR, flexShrink: 0 }} />
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--color-ink)" }}>人材側へのメール</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <a
            href={origMailUrl ?? undefined}
            target="_blank" rel="noopener noreferrer"
            className="btn ghost btn-xs"
            style={{ textDecoration: "none", opacity: origMailUrl ? 1 : 0.35, pointerEvents: origMailUrl ? "auto" : "none", cursor: origMailUrl ? "pointer" : "not-allowed" }}
            title={!origMailUrl ? "元メールのURLがありません" : (/#search\//.test(origMailUrl) ? "Gmail で関連メールを検索（原本URL未登録のためフォールバック）" : "元のメールを開く")}
            aria-disabled={!origMailUrl}
          >
            ↗ 元メール{origMailUrl && /#search\//.test(origMailUrl) ? "（検索）" : ""}
          </a>
          {badgeLabel && (
            <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 10px", borderRadius: 99, background: DOT_COLOR + "18", color: DOT_COLOR, border: `1px solid ${DOT_COLOR}44`, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {badgeLabel}
            </span>
          )}
        </div>
      </div>

      {/* Fixed fields：送信元/送信先は自動入力（編集不可）、CCのみ任意入力 */}
      <div style={{ padding: "12px 16px", flexShrink: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        <label style={fieldLabel}>
          担当者
          <select value={proposer} onChange={(e) => onProposerChange(e.target.value)} style={inputBase}>
            <option value="">—</option>
            {PROPOSERS.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
        <label style={fieldLabel}>
          送信元（共有 / 自動）
          <input
            type="text" value={SHARED_MAILBOX} readOnly
            title="ITS事業部の共有メールボックス。全員が送信内容を共有Gmailで閲覧できます。"
            style={{ ...inputBase, background: "var(--color-surface-soft)", color: "var(--color-ink-2)", cursor: "not-allowed" }}
          />
        </label>
        <label style={fieldLabel}>
          送信先（自動）
          <input
            type="email" value={form.email} readOnly
            placeholder="（取込メールから自動入力）"
            style={{ ...inputBase, background: "var(--color-surface-soft)", color: "var(--color-ink-2)", cursor: "not-allowed" }}
          />
        </label>
        <label style={fieldLabel}>
          CC（任意）
          <input
            type="text" value={form.cc} placeholder="cc@example.com（カンマ区切りで複数可）"
            onChange={(e) => onChange("cc", e.target.value)}
            style={{ ...inputBase, borderColor: errors.cc ? "var(--color-danger)" : "var(--color-border-strong)" }}
          />
          {errors.cc && <div style={errText}>{errors.cc}</div>}
        </label>
      </div>

      {/* 元メール本文プレビュー：本当に合っているか目視確認用（既定で閉、開けば全文表示・スクロール可） */}
      {origMailBody && (
        <details style={{ margin: "0 16px 8px", border: "1px solid var(--color-border)", borderRadius: 8, background: "var(--color-surface-soft)" }}>
          <summary style={{ cursor: "pointer", listStyle: "none", padding: "8px 12px", fontSize: 11.5, fontWeight: 700, color: "var(--color-ink-2)", display: "flex", alignItems: "center", gap: 6 }}>
            <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 16, lineHeight: 1, color: "var(--color-ink-4)" }}>expand_more</span>
            📨 元メール本文を見る（取込元の全文）
            <span className="muted" style={{ fontSize: 10.5, fontWeight: 500, marginLeft: "auto" }}>{origMailBody.length.toLocaleString("ja-JP")} 文字</span>
          </summary>
          <pre style={{ margin: 0, padding: "8px 12px 12px", maxHeight: 240, overflow: "auto", fontFamily: "var(--font-sans)", fontSize: 12, lineHeight: 1.7, whiteSpace: "pre-wrap", wordBreak: "break-word", color: "var(--color-ink-2)" }}>{origMailBody}</pre>
        </details>
      )}

      {/* Body — splits at BUTTON_PLACEHOLDER: editable above, chip in middle, read-only signature below */}
      <div style={{ flex: 1, minHeight: 0, padding: "0 16px 16px", display: "flex", flexDirection: "column", gap: 4, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <span style={{ fontSize: 11, color: "var(--color-ink-4)" }}>本文</span>
          {!form.body.includes(BUTTON_PLACEHOLDER) && (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 11, color: "#b45309" }}>⚠ 返信ボタンが削除されています</span>
              <button
                type="button"
                onClick={() => {
                  const cleaned = form.body
                    .replace(/^.*<<[A-Z_].*$/gm, "")
                    .replace(/^.*[A-Z_]+>>.*$/gm, "")
                    .replace(/\n{3,}/g, "\n\n");
                  const sig = cleaned.indexOf("∞∞∞");
                  const restored = sig >= 0
                    ? cleaned.slice(0, sig) + BUTTON_PLACEHOLDER + "\n" + cleaned.slice(sig)
                    : cleaned + "\n" + BUTTON_PLACEHOLDER;
                  onChange("body", restored);
                }}
                style={{ fontSize: 11, padding: "2px 8px", borderRadius: 5, border: "1px solid #d97706", background: "#fffbeb", color: "#b45309", cursor: "pointer" }}
              >
                復元
              </button>
            </div>
          )}
        </div>
        {(() => {
          const parts = form.body.split(BUTTON_PLACEHOLDER);
          const before = parts[0] ?? form.body;
          const after = parts[1] ?? "";
          const hasPlaceholder = parts.length === 2;
          const ar = (el: HTMLTextAreaElement | null) => {
            if (!el) return;
            const container = el.parentElement;
            const savedScroll = container?.scrollTop ?? 0;
            el.style.height = "auto";
            el.style.height = el.scrollHeight + "px";
            if (container) container.scrollTop = savedScroll;
          };
          const taStyle: React.CSSProperties = {
            display: "block", width: "100%", boxSizing: "border-box",
            fontFamily: "inherit", fontSize: 13, lineHeight: 1.75,
            padding: "10px 14px", border: "none", outline: "none",
            resize: "none", overflowY: "hidden", background: "transparent",
            color: "var(--color-ink)",
          };
          const outer: React.CSSProperties = {
            flex: 1, minHeight: 0, overflowY: "auto", borderRadius: 8,
            border: `1px solid ${errors.body ? "var(--color-danger)" : "var(--color-border-strong)"}`,
            background: "var(--color-surface)",
          };
          if (!hasPlaceholder) {
            return (
              <div style={outer}>
                <textarea
                  ref={ar}
                  value={form.body}
                  onChange={(e) => { ar(e.currentTarget); onChange("body", e.target.value); }}
                  style={taStyle}
                />
              </div>
            );
          }
          return (
            <div style={outer}>
              <textarea
                ref={ar}
                value={before}
                onChange={(e) => { ar(e.currentTarget); onChange("body", e.target.value + BUTTON_PLACEHOLDER + after); }}
                style={taStyle}
              />
              <div style={{ padding: "6px 14px", borderTop: "1px dashed #e2e8f0", borderBottom: "1px dashed #e2e8f0", background: "#f8fafc", fontSize: 12, color: "#475569", textAlign: "center" }}>
                📨 返信ボタン（確認画面で表示）
              </div>
              <textarea
                ref={ar}
                value={after.replace(/^\n/, "")}
                onChange={(e) => { ar(e.currentTarget); onChange("body", before + BUTTON_PLACEHOLDER + "\n" + e.target.value); }}
                style={{ ...taStyle, fontSize: 12, color: "var(--color-ink-3)" }}
              />
            </div>
          );
        })()}
        {errors.body && <div style={errText}>{errors.body}</div>}
      </div>
    </div>
  );
}
