"use client";

import { PROPOSERS, SHARED_MAILBOX } from "@/lib/proposal-constants";
import { reSubject } from "@/lib/gmail";

export type MailForm = { email: string; cc: string; subject: string; body: string };
export type MailErrors = { email?: string; cc?: string; subject?: string; body?: string };

export const BUTTON_PLACEHOLDER = "<<RESPONSE_BUTTONS>>";
export const NOTICE_TEXT = "こちらは料金は発生しません。\n進捗があり次第、担当者よりご連絡させていただきます。";

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

/** 取込元メール本文（note/detail）から「相手の連絡先メール」を抽出する。
 *   email / contact_email が未登録（CSV取込・旧データ等）の場合の送信先フォールバック。
 *   自社ドメイン（8grp/enger）や no-reply 系は返信先ではないので除外する。
 *   見つからなければ null（送信モーダルで手入力できる）。 */
export function extractReplyEmail(text?: string | null): string | null {
  const s = (text ?? "").toString();
  if (!s) return null;
  const RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
  const OWN = /@(?:[a-z0-9-]+\.)?(?:8grp\.co\.jp|enger\.jp)$/i;
  const BAD = /^(?:no-?reply|do-?not-?reply|noreply|postmaster|mailer-daemon|abuse)@/i;
  const all = s.match(RE) ?? [];
  for (const e of all) { if (!OWN.test(e) && !BAD.test(e)) return e; }
  return null;
}

/** スキルシートのリンクを解決する。
 *   1) 取込時に保存済みの skill_sheet_url を最優先。
 *   2) 無い場合は、先方が「添付ではなくリンクで」送ってきたスキルシートURLを
 *      取込元メール本文（cand.note）から抽出する（旧enger同様、リンクを自動記載するため）。
 *   ※ 署名や会社サイト等の無関係URLを拾わないよう、スキルシート/経歴系の語の近く、
 *      もしくはファイル共有系ドメインのURLだけを採用する（任意URLは採用しない）。 */
export function resolveSkillSheetUrl(cand: any): string | null {
  const saved = (cand?.skill_sheet_url ?? "").toString().trim();
  if (saved) return saved;
  const text = (cand?.note ?? "").toString();
  if (!text) return null;
  const URL_RE = /https?:\/\/[^\s<>"')\]　、，]+/g;
  const KEY_RE = /(スキルシート|ｽｷﾙｼｰﾄ|スキルシ-ト|経歴書|職務経歴|技術経歴|skill\s*sheet|ss[:：])/i;
  const DOC_RE = /(drive\.google|docs\.google|1drv\.ms|onedrive|sharepoint|dropbox|box\.com|\.pdf|\.xlsx?|\.docx?|\.pptx?)/i;
  const lines = text.split(/\r?\n/);
  // ① 「スキルシート：URL」のように同じ行に出てくるURL
  for (const ln of lines) {
    if (KEY_RE.test(ln)) { const m = ln.match(URL_RE); if (m?.[0]) return m[0]; }
  }
  // ② 「スキルシート：」の次行にURLがあるパターン
  for (let i = 0; i < lines.length - 1; i++) {
    if (KEY_RE.test(lines[i])) { const m = (lines[i + 1] ?? "").match(URL_RE); if (m?.[0]) return m[0]; }
  }
  // ③ キーワードが無くても、ファイル共有系ドメインのURLがあれば採用
  const urls: string[] = text.match(URL_RE) ?? [];
  const doc = urls.find((u: string) => DOC_RE.test(u));
  return doc ?? null;
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

  const sheetUrl = resolveSkillSheetUrl(cand);
  const skillSheet = sheetUrl
    ? `\n━━━━━━━━━━━━━━━━━━━\nスキルシート：\n${sheetUrl}\n`
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
${BUTTON_PLACEHOLDER}
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
