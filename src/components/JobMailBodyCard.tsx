"use client";

import { PROPOSERS, SHARED_MAILBOX } from "@/lib/proposal-constants";
import { BUTTON_PLACEHOLDER } from "@/lib/proposal-mail";

export type MailForm = { email: string; cc: string; subject: string; body: string };
export type MailErrors = { email?: string; cc?: string; subject?: string; body?: string };

// 定義本体は @/lib/proposal-mail（サーバの予約配信と共通化）。既存 import 互換のため再export。
export {
  BUTTON_PLACEHOLDER, NOTICE_TEXT,
  buildJobMailSubject, buildJobMailContent,
  extractReplyEmail, resolveSkillSheetUrl,
} from "@/lib/proposal-mail";

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
  form, errors, proposer, onProposerChange, onChange, badgeLabel, origMailUrl, origMailBody,
}: {
  form: MailForm;
  errors: MailErrors;
  proposer: string;
  onProposerChange: (v: string) => void;
  onChange: (field: keyof MailForm, v: string) => void;
  badgeLabel: string;
  origMailUrl?: string | null;
  /** 取込元メール本文（あれば UI 内に全文プレビューを展開できる）。本当に合っているか目視確認用。 */
  origMailBody?: string | null;
}) {
  return (
    <div style={{ flex: 1, minWidth: 0, border: "1px solid var(--color-border)", borderRadius: 12, background: "var(--color-surface)", boxShadow: "0 1px 3px rgba(15,23,42,.06)", display: "flex", flexDirection: "column", height: "calc(100vh - 160px)", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: "1px solid var(--color-border)", background: "var(--color-surface-soft)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 12, height: 12, borderRadius: "50%", background: DOT_COLOR, flexShrink: 0 }} />
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--color-ink)" }}>案件側へのメール</span>
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

      {/* Fixed fields：送信元/送信先は自動入力（編集不可）、CCのみ任意入力。
          担当者（提案者）は確認画面で自動入力されるため、ここでの選択UIは廃止。 */}
      <div style={{ padding: "12px 16px", flexShrink: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        <label style={fieldLabel}>
          送信元（共有 / 自動）
          <input
            type="text" value={SHARED_MAILBOX} readOnly
            title="ITS事業部の共有メールボックス。全員が送信内容を共有Gmailで閲覧できます。"
            style={{ ...inputBase, background: "var(--color-surface-soft)", color: "var(--color-ink-2)", cursor: "not-allowed" }}
          />
        </label>
        <label style={fieldLabel}>
          送信先{form.email ? "（自動・編集可）" : "（未取得：入力してください）"}
          <input
            type="email" value={form.email}
            onChange={(e) => onChange("email", e.target.value)}
            placeholder="to@example.com（取込メールから自動入力／未取得時は手入力）"
            style={{ ...inputBase, borderColor: form.email ? "var(--color-border-strong)" : "var(--color-danger)" }}
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
