"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { gmailMessageUrl } from "@/lib/gmail";
import { createProposal } from "@/lib/actions";
import { JobMailBodyCard, buildJobMailContent, buildJobMailSubject } from "./JobMailBodyCard";
import { CandMailBodyCard, buildCandMailContent, buildCandMailSubject } from "./CandMailBodyCard";
import type { MailForm, MailErrors } from "./JobMailBodyCard";

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

function MailPreviewCard({ title, dotColor, email, subject, body, origMailUrl, proposer }: {
  title: string; dotColor: string;
  email: string; subject: string; body: string;
  origMailUrl?: string | null; proposer: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try { await navigator.clipboard.writeText(body); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* noop */ }
  };

  const fieldRow: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 3, fontSize: 11, color: "var(--color-ink-4)" };
  const fieldVal: React.CSSProperties = { fontSize: 12.5, fontWeight: 500, color: "var(--color-ink)", padding: "5px 9px", borderRadius: 7, border: "1px solid var(--color-border)", background: "var(--color-surface-soft)", wordBreak: "break-all" };

  return (
    <div style={{ flex: 1, minWidth: 0, border: "1px solid var(--color-border)", borderRadius: 12, background: "var(--color-surface)", boxShadow: "0 1px 3px rgba(15,23,42,.06)", display: "flex", flexDirection: "column", height: "calc(100vh - 160px)", overflow: "hidden" }}>
      {/* Header with actions */}
      <div style={{ position: "sticky", top: 0, zIndex: 1, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", borderBottom: "1px solid var(--color-border)", background: "var(--color-surface-soft)", flexShrink: 0, gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <div style={{ width: 12, height: 12, borderRadius: "50%", background: dotColor, flexShrink: 0 }} />
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--color-ink)", whiteSpace: "nowrap" }}>{title}</span>
        </div>
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          <button type="button" onClick={handleCopy} className="btn ghost btn-xs" title="本文をクリップボードにコピー">
            {copied ? "✓ コピー済" : "📄 コピー"}
          </button>
          <a
            href={origMailUrl ?? undefined}
            target="_blank" rel="noopener noreferrer"
            className="btn ghost btn-xs"
            style={{ textDecoration: "none", opacity: origMailUrl ? 1 : 0.35, pointerEvents: origMailUrl ? "auto" : "none", cursor: origMailUrl ? "pointer" : "not-allowed" }}
            title={origMailUrl ? "元のメールを開く" : "元メールのURLがありません"}
            aria-disabled={!origMailUrl}
          >
            ↗ 元メール
          </a>
        </div>
      </div>

      {/* Read-only fields */}
      <div style={{ padding: "12px 16px", flexShrink: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={fieldRow}>担当者<span style={fieldVal}>{proposer || "—"}</span></div>
        <div style={fieldRow}>宛先<span style={fieldVal}>{email || "—"}</span></div>
        <div style={fieldRow}>件名<span style={fieldVal}>{subject || "—"}</span></div>
      </div>

      {/* Body preview */}
      <div style={{ flex: 1, minHeight: 0, padding: "0 16px 16px", display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 11, color: "var(--color-ink-4)", flexShrink: 0 }}>本文</span>
        <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
          <pre style={{ margin: 0, fontSize: 12.5, lineHeight: 1.8, whiteSpace: "pre-wrap", fontFamily: "inherit", color: "var(--color-ink-2)" }}>
            {body || "（本文なし）"}
          </pre>
        </div>
      </div>
    </div>
  );
}

const isValidEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

function validateSide(
  form: MailForm,
  setErrors: (e: MailErrors) => void,
  label: string,
): boolean {
  const errors: MailErrors = {};
  if (!form.email.trim()) {
    errors.email = `${label}の宛先を入力してください`;
  } else if (!isValidEmail(form.email)) {
    errors.email = `${label}の宛先に有効なメールアドレスを入力してください`;
  }
  if (form.cc.trim()) {
    const ccList = form.cc.split(",").map((s) => s.trim()).filter(Boolean);
    if (ccList.some((e) => !isValidEmail(e))) {
      errors.cc = `${label}のCcに有効なメールアドレスをカンマ区切りで入力してください`;
    }
  }
  if (!form.subject.trim()) errors.subject = `${label}の件名を入力してください`;
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
  const [savedId, setSavedId] = useState<string | null>(initialSavedId);
  const [msg, setMsg] = useState<string | null>(null);

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
    if (clientOk && candOk) setStep(2);
  };

  const handleSave = async () => {
    if (job?.job_no == null || cand?.candidate_no == null) { setMsg("保存できません（ID不足）"); return; }
    setSaving(true); setMsg(null);
    try {
      const res = await createProposal(job.job_no, cand.candidate_no, score, proposer || undefined);
      if (res.ok) { setSaved(true); setSavedId(res.id ?? null); setMsg(res.existed ? "既に提案済みです" : "保存しました（提案ボードに追加）"); }
      else setMsg(res.error || "保存に失敗しました");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "保存に失敗しました");
    } finally { setSaving(false); }
  };

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
            />
            <CandMailBodyCard
              form={candForm}
              errors={candErrors}
              proposer={proposer}
              onProposerChange={setProposer}
              onChange={updateCandForm}
              badgeLabel={candBadge}
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
              email={clientForm.email} subject={clientForm.subject} body={clientForm.body}
              origMailUrl={gmailMessageUrl(job.source_mail_url) || null}
              proposer={proposer}
            />
            <MailPreviewCard
              title="人材側メール" dotColor="#3b82f6"
              email={candForm.email} subject={candForm.subject} body={candForm.body}
              origMailUrl={gmailMessageUrl(cand.source_mail_url) || null}
              proposer={proposer}
            />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" className="btn ghost" onClick={() => setStep(1)}>← 編集に戻る</button>
            {saved ? (
              <>
                <span className="btn" style={{ cursor: "default", color: "#1aa260", borderColor: "#bfe3cc", background: "#eef8f1" }}>✓ 保存済み</span>
                <Link href="/proposals" className="muted" style={{ fontSize: 11.5, textDecoration: "underline" }}>提案管理を開く</Link>
              </>
            ) : (
              <button type="button" className="btn brand" onClick={handleSave} disabled={saving}>
                {saving ? "処理中…" : "💾 保存する"}
              </button>
            )}
          </div>
          {msg && <div style={{ fontSize: 12, color: saved ? "#067647" : "var(--color-danger)", textAlign: "right" }}>{msg}</div>}
        </>
      )}
    </div>
  );
}
