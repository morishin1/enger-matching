"use client";

import { useMemo, useState, useEffect } from "react";
import Link from "next/link";
import { candidateProposalMail, jobProposalMail, gmailComposeUrl, gmailSearchUrl, gmailMessageUrl, buildProposalPrompt } from "@/lib/gmail";
import { createProposal, undoProposal } from "@/lib/actions";
import { MailBodyModal } from "./MailBodyModal";

type Job = any;
type Cand = any;

export function ProposalComposer({
  job, cand, matchedSkills, missingSkills, score, alreadyProposed = false, proposalId = null,
}: {
  job: Job; cand: Cand; matchedSkills: string[]; missingSkills?: string[]; score: number;
  alreadyProposed?: boolean;
  proposalId?: string | null;
}) {
  const [target, setTarget] = useState<"client" | "cand">("client");
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(alreadyProposed);
  const [savedId, setSavedId] = useState<string | null>(proposalId);
  const [undoing, setUndoing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
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
      candidateCompany: (() => {
        // 「一社下社員」「フリーランス」等の区分(affiliation)が source_company/company に紛れ込んでいる旧データを除外
        const isAff = (v?: string | null) => !!v && /(社員|フリーランス|個人事業|パートナー|下社員|社内|プロパー|PP|社下|協力会社)/.test(String(v));
        const sc = cand.source_company; const co = cand.company;
        if (sc && !isAff(sc)) return sc;
        if (co && !isAff(co)) return co;
        return null;
      })(),
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

  // 新規メール作成（元スレッドが無い／使わない場合）。新規なので件名の "Re:" は外す。
  const composeSubject = tpl.subject.replace(/^re:\s*/i, "");
  const openNewMail = () => {
    window.open(gmailComposeUrl({ to: tpl.to, subject: composeSubject, body: effectiveBody }), "_blank", "noopener");
  };

  // 元メール（原本）：読む用は検索フォールバックあり。返信用は「実際のスレッド」が必要なので
  // gmailMessageUrl（保存済みメッセージID/URL）が取れる時だけ有効にする。
  const origMailUrl = job?.source_mail_url || gmailSearchUrl([job?.client_name, job?.title].filter(Boolean).join(" "));
  const candMailUrl = cand?.source_mail_url || (cand?.name ? gmailSearchUrl([cand?.source_company, cand?.name].filter(Boolean).join(" ")) : null);
  const openOriginal = () => window.open(origMailUrl, "_blank", "noopener");
  const openCandidateOriginal = () => { if (candMailUrl) window.open(candMailUrl, "_blank", "noopener"); };

  // 返信対象スレッド：提案先(target)に応じて切り替える。
  //   - クライアントへ提案 → 案件の元メール（クライアントからの問い合わせ）に返信
  //   - 人材へ案件紹介     → 人材の元メール（取込元）に返信
  const replyThreadUrl = target === "client" ? gmailMessageUrl(job?.source_mail_url) : gmailMessageUrl(cand?.source_mail_url);
  const replyTargetLabel = target === "client" ? "案件の元メール" : "人材の元メール";
  // URL では Gmail の返信フォームに本文を流し込めないため、本文をクリップボードへコピーしてから
  // 元スレッドを開き、Gmailの「返信」に貼り付けてもらう（＝本当の返信スレッドになる）。
  const replyOnThread = async () => {
    if (!replyThreadUrl) return;
    try { await navigator.clipboard.writeText(effectiveBody); setMsg(`本文をコピーしました。開いた${replyTargetLabel}の「返信」に貼り付けてください。`); }
    catch { setMsg(`本文のコピーに失敗しました。${replyTargetLabel}を開きます（本文は手動でコピーしてください）。`); }
    window.open(replyThreadUrl, "_blank", "noopener");
  };

  const proposeToBoard = async () => {
    if (saved) return;
    if (job?.job_no == null || cand?.candidate_no == null) { setMsg("提案できません（ID不足）"); return; }
    setSaving(true); setMsg(null);
    try {
      const res = await createProposal(job.job_no, cand.candidate_no, score);
      if (res.ok) { setSaved(true); setSavedId(res.id ?? null); setMsg(res.existed ? "既に提案済みです" : "提案しました（提案ボードに追加）"); }
      else setMsg(res.error || "提案に失敗しました");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "提案に失敗しました");
    } finally { setSaving(false); }
  };

  const handleUndo = () => {
    if (!savedId) { setMsg("取り消せません（IDが不明です。提案管理から削除してください）"); return; }
    setConfirmOpen(true);
  };

  const doUndo = async () => {
    setConfirmOpen(false);
    setUndoing(true); setMsg(null);
    try {
      const res = await undoProposal(savedId!);
      if (res.ok) { setSaved(false); setSavedId(null); setMsg("提案を取り消しました"); }
      else setMsg(res.error || "取り消しに失敗しました");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "取り消しに失敗しました");
    } finally { setUndoing(false); }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 11, color: "var(--color-ink-4)", fontWeight: 600 }}>
        このペアで提案。<b>元メールに返信</b>すれば相手のスレッドに繋がり、件名も自動で「Re:」になります（本文は自動コピー）。元スレッドが無い場合は<b>新規メール</b>で作成します。
      </div>

      {/* 宛先タブ（評価マークと同じオレンジ系で切替を目立たせる） */}
      <div style={{ display: "flex", gap: 4, padding: 3, background: "#fffbeb", border: "1px solid #fde9b0", borderRadius: 99, alignSelf: "flex-start" }}>
        {[{ id: "client", label: "クライアントへ人材提案" }, { id: "cand", label: "人材へ案件紹介" }].map((t) => {
          const active = target === t.id;
          return (
            <button key={t.id} type="button" onClick={() => switchTarget(t.id as "client" | "cand")}
              style={{
                padding: "7px 18px", borderRadius: 99, border: 0, cursor: "pointer", fontSize: 12.5, fontWeight: 700,
                background: active ? "#f0a92b" : "transparent",
                color: active ? "#fff" : "#b45309",
                boxShadow: active ? "0 1px 3px rgba(240,169,43,.45)" : "none",
                transition: "background .15s ease, color .15s ease",
              }}>
              {t.label}
            </button>
          );
        })}
      </div>

      {/* 件名 */}
      <div style={{ fontSize: 12, color: "var(--color-ink-3)" }}>
        件名：<b style={{ color: "var(--color-ink)" }}>{replyThreadUrl ? `（返信）元の件名に「Re:」が付きます` : composeSubject}</b>
        {tpl.to ? <span className="muted" style={{ marginLeft: 8 }}>宛先 {tpl.to}</span> : <span className="muted" style={{ marginLeft: 8 }}>宛先は手入力</span>}
      </div>

      {/* 本文（編集可） */}
      <textarea
        value={effectiveBody}
        onChange={(e) => { setBody(e.target.value); setTouched(true); }}
        rows={8}
        style={{ width: "100%", fontFamily: "var(--font-sans)", fontSize: 12.5, lineHeight: 1.7, color: "var(--color-ink)", padding: 12, border: "1px solid var(--color-border-strong)", borderRadius: 10, resize: "vertical", background: "var(--color-surface)" }}
      />

      {/* ① 元メールを開く（読む用）：案件・人材それぞれの原本 */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", paddingBottom: 4, borderBottom: "1px dashed var(--color-border)" }}>
        <span style={{ fontSize: 10.5, color: "var(--color-ink-4)", fontWeight: 700 }}>元メールを開く：</span>
        <MailBodyModal body={job?.detail ?? job?.description ?? null} title={job?.title} sub={job?.client_name} mailUrl={origMailUrl} />
        <button type="button" className="btn ghost btn-xs" onClick={openOriginal} title="Gmailで案件の元メールを開く">↗ 案件の元メール</button>
        {candMailUrl && (
          <button type="button" className="btn ghost btn-xs" onClick={openCandidateOriginal} title="Gmailで人材の元メール（取込元）を開く">↗ 人材の元メール</button>
        )}
      </div>

      {/* ② 送信操作：返信(推奨) / 新規 / ボード記録 / コピー */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {replyThreadUrl ? (
          <button type="button" className="btn-mail block" onClick={replyOnThread} title={`本文をコピーして${replyTargetLabel}を開きます。Gmailの「返信」に貼り付けてください`}>
            ↩ {replyTargetLabel}に返信（本文コピー）
          </button>
        ) : (
          <span className="muted" style={{ fontSize: 10.5 }}>※ {replyTargetLabel}が未保存のため返信スレッドを開けません（新規メールで送付）</span>
        )}
        <button type="button" className={replyThreadUrl ? "btn ghost" : "btn-mail block"} onClick={openNewMail} title="Gmailで新規メールを作成（本文を流し込み）">
          ✉ 新規メールで作成
        </button>
        {saved ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            {savedId ? (
              <button type="button" className="btn" onClick={handleUndo} disabled={undoing}
                style={{ color: "#1aa260", borderColor: "#bfe3cc", background: "#eef8f1" }}
                title="クリックして取り消し（記録直後のみ）">
                {undoing ? "取消中…" : "✓ 記録済み（取り消す）"}
              </button>
            ) : (
              <span className="btn" style={{ cursor: "default", color: "#1aa260", borderColor: "#bfe3cc", background: "#eef8f1" }} aria-disabled>✓ 記録済み</span>
            )}
            <Link href="/proposals" className="muted" style={{ fontSize: 10.5, textDecoration: "underline" }}>提案管理</Link>
          </span>
        ) : (
          <button type="button" className="btn brand" onClick={proposeToBoard} disabled={saving}>{saving ? "処理中…" : "提案する（ボードに記録）"}</button>
        )}
        <button type="button" className="btn ghost" onClick={() => copy(effectiveBody, "本文")}>本文をコピー</button>
      </div>
      {msg && <div style={{ fontSize: 11.5, color: "var(--color-ink-3)" }}>{msg}</div>}

      {confirmOpen && (
        <div onClick={() => setConfirmOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", display: "grid", placeItems: "center", zIndex: 400, padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "100%", maxWidth: 360, display: "flex", flexDirection: "column", gap: 14, padding: 24 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>提案を取り消しますか？</div>
            <div style={{ fontSize: 12.5, color: "var(--color-ink-3)", lineHeight: 1.7 }}>
              記録直後（ステージ未変更・次のアクション未入力・60秒以内）の場合のみ取り消せます。<br />
              条件を満たさない場合はエラーが表示されます。
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" className="btn ghost" onClick={() => setConfirmOpen(false)}>キャンセル</button>
              <button type="button" className="btn" onClick={doUndo} style={{ background: "var(--color-danger)", borderColor: "var(--color-danger)", color: "#fff" }}>取り消す</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
