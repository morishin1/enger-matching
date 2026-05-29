"use client";

import { useMemo, useState, useEffect } from "react";
import Link from "next/link";
import { candidateProposalMail, jobProposalMail, gmailComposeUrl, gmailSearchUrl, reSubject, buildProposalPrompt } from "@/lib/gmail";
import { createProposal } from "@/lib/actions";
import { MailBodyModal } from "./MailBodyModal";

type Job = any;
type Cand = any;

export function ProposalComposer({
  job, cand, matchedSkills, missingSkills, score, alreadyProposed = false,
}: {
  job: Job; cand: Cand; matchedSkills: string[]; missingSkills?: string[]; score: number;
  alreadyProposed?: boolean; // この案件×人材ペアが既に提案ボードにあるか（DB由来）
}) {
  const [target, setTarget] = useState<"client" | "cand">("client");
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(alreadyProposed);
  const [sender, setSender] = useState("");

  // 操作中の担当者名（サイドバー/トップ右で選択した名前）を差出人に
  useEffect(() => { try { setSender(localStorage.getItem("enger.operator") || ""); } catch { /* noop */ } }, []);

  // 宛先・件名・テンプレ本文（target ごと）
  const tpl = useMemo(() => {
    if (target === "client") {
      const m = jobProposalMail({
        jobTitle: job.title, clientName: job.client_name, contactName: job.contact_name, sender,
        candidate: {
          name: cand.name, title: cand.title, skills: cand.skills, rate: cand.rate,
          affiliation: cand.affiliation, exp: cand.exp,
          skillSheetUrl: cand.skill_sheet_url ?? cand.skillSheetUrl ?? null,
          ageBand: cand.age_band ?? null,
          avail: cand.avail ?? null,
          location: cand.location ?? null,
        },
        matchedSkills, score,
        originalBody: job.detail ?? job.description ?? null,
        originalMailUrl: job.source_mail_url ?? null,
      });
      return { to: job.contact_email as string | null, subject: m.subject, body: m.body };
    }
    const m = candidateProposalMail({
      candidateName: cand.name,
      candidateCompany: cand.source_company ?? cand.company ?? null,
      contactName: cand.contact_name,
      ageBand: cand.age_band ?? null,
      sender,
      job: {
        title: job.title, client_name: job.client_name, role_label: job.role_label,
        skills: job.skills, salary_min: job.salary_min, salary_max: job.salary_max,
        detail: job.detail ?? null,
        work_location: job.work_location ?? null,
        flow_note: job.flow_note ?? null,
        start_date: job.start_date ?? null,
        remote_type: job.remote_type ?? null,
      },
      matchedSkills, score,
    });
    return { to: (cand.email ?? cand.contact_email) as string | null, subject: m.subject, body: m.body };
  }, [target, job, cand, matchedSkills, score, sender]);

  const effectiveBody = touched ? body : tpl.body;

  const prompt = useMemo(
    () => buildProposalPrompt({ target, job, cand, matchedSkills, missingSkills, score, sender }),
    [target, job, cand, matchedSkills, missingSkills, score, sender],
  );

  const switchTarget = (t: "client" | "cand") => { setTarget(t); setTouched(false); setBody(""); setMsg(null); };

  const copy = async (text: string, label: string) => {
    try { await navigator.clipboard.writeText(text); setMsg(`${label}をコピーしました`); }
    catch { setMsg("コピーに失敗しました（手動で選択してください）"); }
  };

  const generate = async () => {
    setLoading(true); setMsg(null);
    try {
      const res = await fetch("/api/proposal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt }) });
      const data = await res.json();
      if (data.ok) { setBody(data.text); setTouched(true); setMsg(data.cached ? "AI生成（キャッシュ）" : "AIで生成しました"); }
      else setMsg(data.error || "生成に失敗しました");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "生成に失敗しました");
    } finally { setLoading(false); }
  };

  const openGmail = () => {
    window.open(gmailComposeUrl({ to: tpl.to, subject: tpl.subject, body: effectiveBody }), "_blank", "noopener");
  };

  // ① 元メール（案件メール）へのアクセス：内容確認は本文モーダル、原文/返信は Gmail を該当アカウントで開く
  const origMailUrl = job?.source_mail_url || gmailSearchUrl([job?.client_name, job?.title].filter(Boolean).join(" "));
  const openOriginal = () => window.open(origMailUrl, "_blank", "noopener");
  // 「元メールに返信」：URL ベースでは Gmail のスレッド返信フォームは直接開けないため、
  // 元メールを Gmail で開いて、そこの「返信」ボタンを使ってもらう動線に変更（旧実装は新規メールになる問題があった）。
  const replyToOriginal = () => window.open(origMailUrl, "_blank", "noopener");
  // 人材の元メール（人材CSVの取込元メール）。注力対象の人材本人の問い合わせメールを開く。
  const candMailUrl = cand?.source_mail_url || (cand?.name ? gmailSearchUrl([cand?.source_company, cand?.name].filter(Boolean).join(" ")) : null);
  const openCandidateOriginal = () => { if (candMailUrl) window.open(candMailUrl, "_blank", "noopener"); };

  // 提案する＝提案ボードに記録。提案済みは固定表示（このペアのみ）。取消は「提案管理」での削除のみ。
  const proposeToBoard = async () => {
    if (saved) return; // 既に提案済み（取消は提案管理から）
    if (job?.job_no == null || cand?.candidate_no == null) { setMsg("提案できません（ID不足）"); return; }
    setSaving(true); setMsg(null);
    try {
      const res = await createProposal(job.job_no, cand.candidate_no, score);
      if (res.ok) { setSaved(true); setMsg(res.existed ? "既に提案済みです" : "提案しました（提案ボードに追加）"); }
      else setMsg(res.error || "提案に失敗しました");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "提案に失敗しました");
    } finally { setSaving(false); }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 11, color: "var(--color-ink-4)", fontWeight: 600 }}>
        このペアで提案（相手は返信メールにアクションしやすいので返信形式で送付）
      </div>

      {/* 宛先タブ */}
      <div style={{ display: "flex", gap: 4, padding: 3, background: "var(--color-surface-inset)", borderRadius: 99, alignSelf: "flex-start" }}>
        {[{ id: "client", label: "クライアントへ人材提案" }, { id: "cand", label: "人材へ案件紹介" }].map((t) => {
          const active = target === t.id;
          return (
            <button key={t.id} type="button" onClick={() => switchTarget(t.id as "client" | "cand")}
              style={{ padding: "6px 14px", borderRadius: 99, border: 0, cursor: "pointer", fontSize: 12, fontWeight: 600,
                background: active ? "var(--color-surface)" : "transparent", color: active ? "var(--color-ink)" : "var(--color-ink-3)",
                boxShadow: active ? "0 1px 2px rgba(15,23,42,.08)" : "none" }}>
              {t.label}
            </button>
          );
        })}
      </div>

      {/* 件名 */}
      <div style={{ fontSize: 12, color: "var(--color-ink-3)" }}>
        件名：<b style={{ color: "var(--color-ink)" }}>{tpl.subject}</b>
        {tpl.to ? <span className="muted" style={{ marginLeft: 8 }}>宛先 {tpl.to}</span> : <span className="muted" style={{ marginLeft: 8 }}>宛先は手入力</span>}
      </div>

      {/* 本文（編集可） */}
      <textarea
        value={effectiveBody}
        onChange={(e) => { setBody(e.target.value); setTouched(true); }}
        rows={8}
        style={{ width: "100%", fontFamily: "var(--font-sans)", fontSize: 12.5, lineHeight: 1.7, color: "var(--color-ink)", padding: 12, border: "1px solid var(--color-border-strong)", borderRadius: 10, resize: "vertical", background: "var(--color-surface)" }}
      />

      {/* ① 元メール（案件・人材それぞれの原本）へのアクセス */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", paddingBottom: 4, borderBottom: "1px dashed var(--color-border)" }}>
        <MailBodyModal body={job?.detail ?? job?.description ?? null} title={job?.title} sub={job?.client_name} mailUrl={origMailUrl} />
        <button type="button" className="btn ghost btn-xs" onClick={openOriginal} title="Gmailで案件の元メールを開く">↗ 案件の元メール</button>
        {candMailUrl && (
          <button type="button" className="btn ghost btn-xs" onClick={openCandidateOriginal} title="Gmailで人材の元メール（取込元）を開く">↗ 人材の元メール</button>
        )}
      </div>

      {/* 操作 */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" className="btn-mail block" onClick={openGmail}>Gmailで開く</button>
        {saved ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span className="btn" style={{ cursor: "default", color: "#1aa260", borderColor: "#bfe3cc", background: "#eef8f1" }} aria-disabled>✓ 記録済み</span>
            <Link href="/proposals" className="muted" style={{ fontSize: 10.5, textDecoration: "underline" }}>取消は提案管理から</Link>
          </span>
        ) : (
          <button type="button" className="btn brand" onClick={proposeToBoard} disabled={saving}>{saving ? "処理中…" : "提案する（ボードに記録）"}</button>
        )}
        <button type="button" className="btn" onClick={generate} disabled={loading}>{loading ? "生成中…" : "✨ AIで自動生成"}</button>
        <button type="button" className="btn ghost" onClick={() => copy(prompt, "AIプロンプト")}>プロンプトをコピー</button>
        <button type="button" className="btn ghost" onClick={() => copy(effectiveBody, "本文")}>本文をコピー</button>
      </div>
      {msg && <div style={{ fontSize: 11.5, color: "var(--color-ink-3)" }}>{msg}</div>}
      <div style={{ fontSize: 10.5, color: "var(--color-ink-4)", lineHeight: 1.6 }}>
        無料：「プロンプトをコピー」→ ChatGPT/Claude/Gemini の無料Webに貼り付け→出力を本文に貼る。
        激安：「AIで自動生成」（APIキー設定時のみ・1通0.01〜0.05円目安）。
      </div>
    </div>
  );
}
