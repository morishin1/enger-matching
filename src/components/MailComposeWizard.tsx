"use client";

import { useState, useEffect, Fragment, type CSSProperties } from "react";
import Link from "next/link";
import { gmailMessageUrl, gmailSearchUrl } from "@/lib/gmail";
import { createProposal } from "@/lib/actions";
import { flowMatch, candDepthLabel, jobDepthLabel } from "@/lib/flow";
import { SendBothMailsButton } from "./SendBothMailsButton";
import { JobMailBodyCard, buildJobMailContent, buildJobMailSubject, BUTTON_PLACEHOLDER } from "./JobMailBodyCard";
import { CandMailBodyCard, buildCandMailContent, buildCandMailSubject } from "./CandMailBodyCard";
import type { MailForm, MailErrors } from "./JobMailBodyCard";

function generateToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

function buildButtonHtml(siteUrl: string, token: string): string {
  const agreeUrl  = `${siteUrl}/respond?token=${token}&action=${encodeURIComponent("話を進める")}`;
  const rejectUrl = `${siteUrl}/respond?token=${token}&action=${encodeURIComponent("見送り")}`;
  return `<table cellpadding="0" cellspacing="0" border="0" style="margin:16px 0">
  <tr>
    <td style="padding-right:12px">
      <a href="${agreeUrl}" target="_blank"
         style="display:inline-block;padding:12px 24px;background:#16a34a;color:#ffffff;font-weight:bold;font-size:14px;border-radius:8px;text-decoration:none;border:2px solid #15803d">
        話を進める
      </a>
    </td>
    <td>
      <a href="${rejectUrl}" target="_blank"
         style="display:inline-block;padding:12px 24px;background:#dc2626;color:#ffffff;font-weight:bold;font-size:14px;border-radius:8px;text-decoration:none;border:2px solid #b91c1c">
        見送り
      </a>
    </td>
  </tr>
</table>
<div style="font-size:11px;color:#1e293b;width:fit-content;max-width:100%;">
こちらは料金は発生しません。<br>進捗があり次第、担当者よりご連絡させていただきます。
</div>`;
}

function StepBar({ current }: { current: 1 | 2 }) {
  const steps = ["メール作成", "確認"];
  return (
    <div style={{ display: "flex", alignItems: "center" }}>
      {steps.map((label, i) => {
        const n = i + 1;
        const active = current === n;
        const done = current > n;
        return (
          <div key={n} style={{ display: "flex", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{
                width: 28, height: 28, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 13, fontWeight: 700, border: "2px solid",
                background: active ? "linear-gradient(135deg,#3b82f6,#2563eb)" : done ? "#059669" : "#fff",
                borderColor: active ? "#3b82f6" : done ? "#059669" : "#e5e7eb",
                color: active || done ? "#fff" : "#9ca3af",
                boxShadow: active ? "0 4px 6px -1px rgba(59,130,246,.3)" : "none",
              }}>
                {done ? "✓" : n}
              </div>
              <span style={{ fontSize: 13, fontWeight: 700, color: active ? "#3b82f6" : done ? "#059669" : "#9ca3af", whiteSpace: "nowrap" }}>
                {label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div style={{ width: 64, height: 1, background: current > 1 ? "#059669" : "#e5e7eb", margin: "0 16px" }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function MailPreviewCard({ title, dotColor, body, origMailUrl, proposer, buttonHtml }: {
  title: string; dotColor: string; body: string; origMailUrl?: string | null; proposer: string;
  buttonHtml?: string | null;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const parts = body.split(BUTTON_PLACEHOLDER);
    const plainText = parts.join("").replace(/\n{3,}/g, "\n\n").trim();
    try {
      if (buttonHtml && typeof (window as any).ClipboardItem !== "undefined") {
        const htmlContent = parts.length === 2
          ? `<div style="white-space:pre-wrap;font-family:sans-serif;font-size:14px">${esc(parts[0])}</div>\n${buttonHtml}\n<div style="white-space:pre-wrap;font-family:sans-serif;font-size:14px">${esc(parts[1].replace(/^\n/, ""))}</div>`
          : `<div style="white-space:pre-wrap;font-family:sans-serif;font-size:14px">${esc(body)}</div>\n${buttonHtml}`;
        await navigator.clipboard.write([new (window as any).ClipboardItem({
          "text/html": new Blob([htmlContent], { type: "text/html" }),
          "text/plain": new Blob([plainText], { type: "text/plain" }),
        })]);
      } else {
        await navigator.clipboard.writeText(plainText);
      }
      setCopied(true); setTimeout(() => setCopied(false), 2000);
    } catch {
      try { await navigator.clipboard.writeText(plainText); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* noop */ }
    }
  };

  const fieldRow: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 3, fontSize: 11, color: "var(--color-ink-4)" };
  const fieldVal: React.CSSProperties = { fontSize: 12.5, fontWeight: 500, color: "var(--color-ink)", padding: "5px 9px", borderRadius: 7, border: "1px solid var(--color-border)", background: "var(--color-surface-soft)", wordBreak: "break-all" };

  return (
    <div style={{ flex: 1, minWidth: 0, border: "1px solid var(--color-border)", borderRadius: 12, background: "var(--color-surface)", boxShadow: "0 1px 3px rgba(15,23,42,.06)", display: "flex", flexDirection: "column", height: "calc(100vh - 160px)", overflow: "hidden" }}>
      <div style={{ position: "sticky", top: 0, zIndex: 1, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", borderBottom: "1px solid var(--color-border)", background: "var(--color-surface-soft)", flexShrink: 0, gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <div style={{ width: 12, height: 12, borderRadius: "50%", background: dotColor, flexShrink: 0 }} />
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--color-ink)", whiteSpace: "nowrap" }}>{title}</span>
        </div>
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          <button type="button" onClick={handleCopy} className="btn ghost btn-xs" title={buttonHtml ? "本文＋ボタンをコピー" : "本文をコピー"}>
            {copied ? "✓ コピー済" : buttonHtml ? "📋 本文＋ボタンをコピー" : "📄 コピー"}
          </button>
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
        </div>
      </div>

      {/* Read-only fields */}
      <div style={{ padding: "12px 16px", flexShrink: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={fieldRow}>担当者<span style={fieldVal}>{proposer || "—"}</span></div>
        {/* <div style={fieldRow}>宛先<span style={fieldVal}>{email || "—"}</span></div>
        <div style={fieldRow}>件名<span style={fieldVal}>{subject || "—"}</span></div> */}
      </div>

      {/* Body preview */}
      <div style={{ flex: 1, minHeight: 0, padding: "0 16px 16px", display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 11, color: "var(--color-ink-4)", flexShrink: 0 }}>本文</span>
        <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
          {(() => {
            const preStyle: CSSProperties = { margin: 0, fontSize: 12.5, lineHeight: 1.8, whiteSpace: "pre-wrap", fontFamily: "inherit", color: "var(--color-ink-2)" };
            const parts = body.split(BUTTON_PLACEHOLDER);
            if (parts.length === 1) {
              return <pre style={preStyle}>{body || "（本文なし）"}</pre>;
            }
            return parts.map((part, i) => (
              <Fragment key={i}>
                <pre style={preStyle}>{i === 0 ? part : part.replace(/^\n/, "")}</pre>
                {i < parts.length - 1 && (
                  <div dangerouslySetInnerHTML={{ __html: buttonHtml! }} />
                )}
              </Fragment>
            ));
          })()}
        </div>
      </div>
    </div>
  );
}

function validateSide(
  form: MailForm,
  setErrors: (e: MailErrors) => void,
  label: string,
): boolean {
  const errors: MailErrors = {};
  if (!form.body.trim()) errors.body = `${label}の本文を入力してください`;
  setErrors(errors);
  return Object.keys(errors).length === 0;
}

const emptyForm = (): MailForm => ({ email: "", cc: "", subject: "", body: "" });

export function MailComposeWizard({
  job, cand, score, initialSaved = false, initialSavedId = null, initialProposer = null,
}: {
  job: any; cand: any; score: number;
  initialSaved?: boolean; initialSavedId?: string | null; initialProposer?: string | null;
}) {
  const [step, setStep] = useState<1 | 2>(initialSaved ? 2 : 1);
  const [proposer, setProposer] = useState(initialProposer ?? "");
  const [clientForm, setClientForm] = useState<MailForm>(emptyForm);
  const [candForm, setCandForm] = useState<MailForm>(emptyForm);
  const [clientErrors, setClientErrors] = useState<MailErrors>({});
  const [candErrors, setCandErrors] = useState<MailErrors>({});
  const [initialized, setInitialized] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(initialSaved);
  const [_savedId, setSavedId] = useState<string | null>(initialSavedId);
  const [jobToken, setJobToken] = useState<string | null>(null);
  const [candToken, setCandToken] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // 元メールリンク：保存済みメッセージIDが無効/未登録の場合でも開けるよう、
  // 関連キーワード(会社名・案件名・人材名)で Gmail 検索URLにフォールバックする。
  const jobOrigUrl = gmailMessageUrl(job?.source_mail_url)
    || gmailSearchUrl([job?.client_name, job?.title].filter(Boolean).join(" "))
    || null;
  const candOrigUrl = gmailMessageUrl(cand?.source_mail_url)
    || (cand?.name ? gmailSearchUrl([cand?.source_company, cand?.name].filter(Boolean).join(" ")) : null);

  useEffect(() => {
    if (initialized) return;
    setClientForm({
      email: job.contact_email ?? "",
      cc: "",
      subject: buildJobMailSubject(job),
      body: buildJobMailContent(job, cand),
    });
    setCandForm({
      email: cand.email || cand.contact_email || "",
      cc: "",
      subject: buildCandMailSubject(),
      body: buildCandMailContent(job, cand),
    });
    setInitialized(true);
  }, [job, cand, initialized]);

  const updateClientForm = (field: keyof MailForm, v: string) => {
    setClientForm((prev) => ({ ...prev, [field]: v }));
    setClientErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const updateCandForm = (field: keyof MailForm, v: string) => {
    setCandForm((prev) => ({ ...prev, [field]: v }));
    setCandErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const handleNext = () => {
    const clientOk = validateSide(clientForm, setClientErrors, "案件側");
    const candOk = validateSide(candForm, setCandErrors, "人材側");
    if (!clientOk || !candOk) return;
    if (!jobToken)  setJobToken(generateToken());
    if (!candToken) setCandToken(generateToken());
    setStep(2);
  };

  const handleSave = async () => {
    if (job?.job_no == null || cand?.candidate_no == null) { setMsg("保存できません（ID不足）"); return; }
    // 商流NGなら提案前にワンクッション確認。
    const fm = flowMatch(job ?? {}, cand ?? {});
    if (fm.compat === "ng") {
      const ok = window.confirm(
        `⚠ 商流NGの可能性\n\n案件の受入：${jobDepthLabel(fm.jobMaxDepth)}\n人材の所属：${candDepthLabel(fm.candDepth)}\n\nこのまま保存を進めますか？`
      );
      if (!ok) { setSaving(false); setMsg("商流NGのため保存を中止しました（提案前に確認してください）"); return; }
    }
    setSaving(true); setMsg(null);
    try {
      const res = await createProposal(
        job.job_no, cand.candidate_no, score, proposer || undefined,
        { jobToken, candToken },
      );
      if (res.ok) {
        setSaved(true); setSavedId(res.id ?? null);
        if (res.existed) {
          setJobToken(null);
          setCandToken(null);
          setMsg("既に提案済みです");
        } else {
          setMsg("保存しました（提案ボードに追加）");
        }
      } else {
        setMsg(res.error || "保存に失敗しました");
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "保存に失敗しました");
    } finally { setSaving(false); }
  };

  const siteUrl = typeof window !== "undefined" ? window.location.origin : (process.env.NEXT_PUBLIC_SITE_URL ?? "");
  const jobButtonHtml  = jobToken  ? buildButtonHtml(siteUrl, jobToken)  : null;
  const candButtonHtml = candToken ? buildButtonHtml(siteUrl, candToken) : null;

  const jobBadge = (job.client_name ?? "").slice(0, 10) || "企業";
  const candBadge = cand.name || cand.initials || "人材";
  const backUrl = `/matching?job=${job.job_no}&cand=${cand.candidate_no}`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Header bar */}
      <div className="card" style={{ padding: "16px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
        <div className="muted" style={{ fontSize: 11.5 }}>
          {job.title} <span style={{ opacity: 0.4 }}>×</span> {cand.name}
        </div>
        <StepBar current={step} />
      </div>

      {step === 1 && (
        <>
          <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
            <JobMailBodyCard
              form={clientForm}
              errors={clientErrors}
              proposer={proposer}
              onProposerChange={setProposer}
              onChange={updateClientForm}
              badgeLabel={jobBadge}
              origMailUrl={jobOrigUrl}
              origMailBody={(job?.detail ?? job?.description ?? null) as string | null}
            />
            <CandMailBodyCard
              form={candForm}
              errors={candErrors}
              proposer={proposer}
              onProposerChange={setProposer}
              onChange={updateCandForm}
              badgeLabel={candBadge}
              origMailUrl={candOrigUrl}
              origMailBody={(cand?.note ?? cand?.exp ?? null) as string | null}
            />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, alignItems: "center" }}>
            <Link href={backUrl} className="btn ghost" style={{ textDecoration: "none" }}>キャンセル</Link>
            <button type="button" className="btn brand" onClick={handleNext}>確認画面へ →</button>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
            <MailPreviewCard
              title="案件側メール" dotColor="#ef4444"
              body={clientForm.body} origMailUrl={jobOrigUrl}
              proposer={proposer} buttonHtml={jobButtonHtml}
            />
            <MailPreviewCard
              title="人材側メール" dotColor="#3b82f6"
              body={candForm.body} origMailUrl={candOrigUrl}
              proposer={proposer} buttonHtml={candButtonHtml}
            />
          </div>
          {/* メインの送信ボタンは中央に配置（基本操作なので目立たせる） */}
          <div style={{ display: "flex", justifyContent: "center", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            {/* Xserver SMTP 送信：1つのモーダルで案件側・人材側の2通をまとめて送信 */}
            <SendBothMailsButton
              label="📨 メールを送信"
              className="btn brand"
              jobSide={{
                label: "案件側メール",
                dotColor: "#ef4444",
                to: clientForm.email,
                cc: clientForm.cc,
                subject: clientForm.subject,
                body: clientForm.body,
                buttonHtml: jobButtonHtml ?? undefined,
                relatedKind: "proposal_job",
                relatedId: _savedId ?? (job.job_no != null ? String(job.job_no) : undefined),
              }}
              candSide={{
                label: "人材側メール",
                dotColor: "#3b82f6",
                to: candForm.email,
                cc: candForm.cc,
                subject: candForm.subject,
                body: candForm.body,
                buttonHtml: candButtonHtml ?? undefined,
                relatedKind: "proposal_cand",
                relatedId: _savedId ?? (cand.candidate_no != null ? String(cand.candidate_no) : undefined),
              }}
            />
          </div>
          {/* 補助操作（編集に戻る・保存）は下段に控えめに配置 */}
          <div style={{ display: "flex", justifyContent: "center", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" className="btn ghost" onClick={() => setStep(1)}>← 編集に戻る</button>
            {saved ? (
              <>
                <span className="btn" style={{ cursor: "default", color: "#1aa260", borderColor: "#bfe3cc", background: "#eef8f1", fontWeight: 700 }}>✓ 保存済み</span>
                {/* 次の動線：色付き＋矢印アイコンで目立たせる */}
                <Link href="/proposals" style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  padding: "9px 18px", borderRadius: 10, textDecoration: "none",
                  background: "linear-gradient(135deg, var(--color-brand-600), #0b5cab)",
                  color: "#fff", fontSize: 13.5, fontWeight: 800,
                  boxShadow: "0 6px 14px rgba(0,149,217,.25)",
                }}>
                  提案管理へ
                  <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 18, lineHeight: 1 }}>arrow_forward</span>
                </Link>
                <span className="muted" style={{ fontSize: 11 }}>← ここに記録されました</span>
              </>
            ) : (
              <button type="button" className="btn ghost" onClick={handleSave} disabled={saving}>
                {saving ? "処理中…" : "💾 保存する"}
              </button>
            )}
          </div>
          {msg && <div style={{ fontSize: 12, color: saved && !msg.includes("既に") ? "#067647" : "var(--color-danger)", textAlign: "center" }}>{msg}</div>}
        </>
      )}
    </div>
  );
}
