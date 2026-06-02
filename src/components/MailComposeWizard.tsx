"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import { jobProposalMail, candidateProposalMail, gmailMessageUrl } from "@/lib/gmail";
import { createProposal } from "@/lib/actions";
import { PROPOSERS } from "@/lib/proposal-constants";

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

const CARD_MAX_H = "calc(100vh - 220px)";

const cardBase = {
  flex: 1, minWidth: 0,
  border: "1px solid var(--color-border)", borderRadius: 12,
  background: "var(--color-surface)", boxShadow: "0 1px 3px rgba(15,23,42,.06)",
  display: "flex", flexDirection: "column" as const,
  height: CARD_MAX_H, overflow: "hidden" as const,
};

function CardHeader({ title, dotColor, badgeLabel }: { title: string; dotColor: string; badgeLabel?: string }) {
  return (
    <div style={{
      position: "sticky", top: 0, zIndex: 1,
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "12px 16px", borderBottom: "1px solid var(--color-border)",
      background: "var(--color-surface-soft)", flexShrink: 0,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ width: 12, height: 12, borderRadius: "50%", background: dotColor, flexShrink: 0 }} />
        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--color-ink)" }}>{title}</span>
      </div>
      {badgeLabel && (
        <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 10px", borderRadius: 99, background: dotColor + "18", color: dotColor, border: `1px solid ${dotColor}44`, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {badgeLabel}
        </span>
      )}
    </div>
  );
}

function MailBodyCard({ title, dotColor, badgeLabel, body, error, onChange, proposer, onProposerChange }: {
  title: string; dotColor: string; badgeLabel: string;
  body: string; error?: string; onChange: (v: string) => void;
  proposer: string; onProposerChange: (v: string) => void;
}) {
  return (
    <div style={cardBase}>
      <CardHeader title={title} dotColor={dotColor} badgeLabel={badgeLabel} />
      <div style={{ padding: "10px 16px 0", flexShrink: 0 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: "var(--color-ink-4)" }}>
          担当者
          <select value={proposer} onChange={(e) => onProposerChange(e.target.value)} style={{ fontFamily: "inherit", fontSize: 12.5, padding: "6px 9px", borderRadius: 8, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)" }}>
            <option value="">—</option>
            {PROPOSERS.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
      </div>
      <div style={{ flex: 1, minHeight: 0, padding: 16, display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 11, color: "var(--color-ink-4)" }}>本文</span>
        <textarea
          value={body}
          onChange={(e) => onChange(e.target.value)}
          style={{
            flex: 1, display: "block", width: "100%", boxSizing: "border-box",
            fontFamily: "inherit", fontSize: 13, lineHeight: 1.75,
            padding: "12px 14px", borderRadius: 8, resize: "none",
            border: `1px solid ${error ? "var(--color-danger)" : "var(--color-border-strong)"}`,
            background: "var(--color-surface)", color: "var(--color-ink)",
            overflowY: "auto",
          }}
        />
        {error && <div style={{ fontSize: 11, color: "var(--color-danger)", marginTop: 4, flexShrink: 0 }}>{error}</div>}
      </div>
    </div>
  );
}

function MailPreviewCard({ title, dotColor, body, origMailUrl, proposer }: {
  title: string; dotColor: string; body: string; origMailUrl?: string | null; proposer: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try { await navigator.clipboard.writeText(body); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* noop */ }
  };

  return (
    <div style={cardBase}>
      {/* Sticky header with action buttons */}
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
      <div style={{ padding: "10px 16px 0", flexShrink: 0 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: "var(--color-ink-4)" }}>
          担当者
          <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--color-ink)", padding: "6px 9px", borderRadius: 8, border: "1px solid var(--color-border)", background: "var(--color-surface-soft)" }}>{proposer || "—"}</span>
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, padding: 16, display: "flex", flexDirection: "column", gap: 4 }}>
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

export function MailComposeWizard({
  job, cand, score, initialSaved = false, initialSavedId = null, initialProposer = null,
}: {
  job: any; cand: any; score: number;
  initialSaved?: boolean; initialSavedId?: string | null; initialProposer?: string | null;
}) {
  const [step, setStep] = useState<1 | 2>(initialSaved ? 2 : 1);
  const [sender, setSender] = useState("");
  const [proposer, setProposer] = useState(initialProposer ?? "");
  const [clientBody, setClientBody] = useState("");
  const [candBody, setCandBody] = useState("");
  const [initialized, setInitialized] = useState(false);
  const [clientError, setClientError] = useState<string | undefined>();
  const [candError, setCandError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(initialSaved);
  const [savedId, setSavedId] = useState<string | null>(initialSavedId);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    try { setSender(localStorage.getItem("enger.operator") || ""); } catch { /* noop */ }
  }, []);

  const tpls = useMemo(() => {
    const clientM = jobProposalMail({
      jobTitle: job.title, clientName: job.client_name, contactName: job.contact_name,
      sender,
      candidate: {
        name: cand.name, title: cand.title, skills: cand.skills, rate: cand.rate,
        affiliation: cand.affiliation, exp: cand.exp,
        skillSheetUrl: cand.skill_sheet_url ?? null,
        ageBand: cand.age_band ?? null, avail: cand.avail ?? null, location: cand.location ?? null,
      },
      matchedSkills: [], score,
      originalBody: job.detail ?? null,
      originalMailUrl: job.source_mail_url ?? null,
    });
    const candM = candidateProposalMail({
      candidateName: cand.name,
      candidateCompany: (() => {
        const isAff = (v?: string | null) => !!v && /(社員|フリーランス|個人事業|パートナー|下社員|社内|プロパー|PP|社下|協力会社)/.test(String(v));
        const sc = cand.source_company; const co = cand.company;
        if (sc && !isAff(sc)) return sc;
        if (co && !isAff(co)) return co;
        return null;
      })(),
      contactName: cand.contact_name, ageBand: cand.age_band ?? null,
      sender,
      job: {
        title: job.title, client_name: job.client_name, role_label: job.role_label,
        skills: job.skills, salary_min: job.salary_min, salary_max: job.salary_max,
        detail: job.detail ?? null, work_location: job.work_location ?? null,
        flow_note: job.flow_note ?? null, start_date: job.start_date ?? null,
        remote_type: job.remote_type ?? null,
      },
      matchedSkills: [], score,
    });
    return { clientBody: clientM.body, candBody: candM.body };
  }, [job, cand, score, sender]);

  useEffect(() => {
    if (!initialized) {
      setClientBody(tpls.clientBody);
      setCandBody(tpls.candBody);
      setInitialized(true);
    }
  }, [tpls, initialized]);

  const validate = () => {
    const ce = clientBody.trim() ? undefined : "本文を入力してください";
    const we = candBody.trim() ? undefined : "本文を入力してください";
    setClientError(ce);
    setCandError(we);
    return !ce && !we;
  };

  const handleNext = () => { if (validate()) setStep(2); };

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
            <MailBodyCard
              title="案件側へのメール" dotColor="#ef4444" badgeLabel={jobBadge}
              body={clientBody} error={clientError}
              onChange={(v) => { setClientBody(v); setClientError(undefined); }}
              proposer={proposer} onProposerChange={setProposer}
            />
            <MailBodyCard
              title="人材側へのメール" dotColor="#3b82f6" badgeLabel={candBadge}
              body={candBody} error={candError}
              onChange={(v) => { setCandBody(v); setCandError(undefined); }}
              proposer={proposer} onProposerChange={setProposer}
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
            <MailPreviewCard title="案件側メール" dotColor="#ef4444" body={clientBody} origMailUrl={gmailMessageUrl(job.source_mail_url) || null} proposer={proposer} />
            <MailPreviewCard title="人材側メール" dotColor="#3b82f6" body={candBody} origMailUrl={gmailMessageUrl(cand.source_mail_url) || null} proposer={proposer} />
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
