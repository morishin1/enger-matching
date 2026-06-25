"use client";

import { useState, useEffect, Fragment, type CSSProperties } from "react";
import Link from "@/components/AppLink";
import { useSearchParams } from "next/navigation";
import { gmailMessageUrl, gmailSearchUrl } from "@/lib/gmail";
import { createProposal, isProposerPrivileged, getProposalTokens, getProposalDraft, getSourceMailSubject } from "@/lib/actions";
import { flowMatchMatrix, JOB_FLOW_LABEL, CAND_FLOW_LABEL } from "@/lib/flow";
import { SendBothMailsButton } from "./SendBothMailsButton";
import { JobMailBodyCard, buildJobMailContent, buildJobMailSubject, BUTTON_PLACEHOLDER, extractReplyEmail } from "./JobMailBodyCard";
import { CandMailBodyCard, buildCandMailContent, buildCandMailSubject, LEGACY_CAND_SUBJECT } from "./CandMailBodyCard";
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

export function MailComposeWizard({
  job, cand, score, initialSaved = false, initialSavedId = null, initialProposer = null, initialApprovalStatus = null, initialDraft = null, members = [],
}: {
  job: any; cand: any; score: number;
  initialSaved?: boolean; initialSavedId?: string | null; initialProposer?: string | null;
  /** 既存提案の承認状態。"approved" のときは提案者本人もこの画面から送信できる（要件4）。 */
  initialApprovalStatus?: string | null;
  /** 既存提案の下書き（pending_mail）。差戻し後の再編集などで定型文に戻さず復元するため。 */
  initialDraft?: { job?: { to?: string; cc?: string; subject?: string; body?: string }; cand?: { to?: string; cc?: string; subject?: string; body?: string } } | null;
  /** 承認者プルダウンの選択肢（社内メンバー名）。空のときは下の保存ボタンは無効。 */
  members?: string[];
}) {
  // 既存提案が承認済みなら、権限の有無にかかわらず送信ボタンを出す（提案者も送れる）。
  const approved = (initialApprovalStatus ?? "").trim() === "approved";
  // 差戻し（rejected）は「未申請」と同じ扱いにして、メール修正後にもう一度「承認申請」を出せるようにする。
  const rejected = (initialApprovalStatus ?? "").trim() === "rejected";
  // 下書き（pending_mail）があればそれを初期値にして「定型文に戻る」事故を防ぐ（要件①）。
  const dJob = initialDraft?.job ?? null;
  const dCand = initialDraft?.cand ?? null;
  // 既存提案があっても、最初は必ず編集画面(step=1)から開始する（編集 → 確認 → 送信のフロー）。
  //   以前は initialSaved ? 2 : 1 で「提案済み」のときに確認画面に直行していたが、
  //   ①📋提案する→②📤送信する の流れで使うと2回目以降の操作時に編集を飛ばして
  //   いきなり確認画面が出てしまい混乱の原因になっていた。
  const [step, setStep] = useState<1 | 2>(1);
  const [proposer, setProposer] = useState(initialProposer ?? "");
  // 担当者（提案者）は必須。未選択なら、画面右上で選択中の操作者(localStorage)を既定にして
  //   入力の手間を省く（操作者未選択なら空のまま＝明示選択を促す）。
  useEffect(() => {
    if (proposer) return;
    try { const op = localStorage.getItem("enger.operator") || ""; if (op) setProposer(op); } catch { /* noop */ }
    // 初回マウント時のみ評価
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 承認者（必須）：保存時に approver として createProposal に渡す
  const [approver, setApprover] = useState("");
  // useState の初期値で定型文を入れて、最初のレンダリングから本文が見える状態にする。
  //   以前は useEffect で後追いで body をセットしていたため、初期マウント時に空のテキストエリアが
  //   見え（auto-resize の高さ計算が空状態で行われ）、結果として本文が見えない事故が発生していた。
  // 案件先担当者を CC に自動反映するための連絡先（案件窓口＋企業マスタ窓口・重複除外）。
  //   案件確認の認識ズレを防ぐため、案件側・人材側の両メールでこれらを CC に入れる。
  const caseCcEmails = Array.from(new Set(
    [job?.contact_email, job?.company_contact_email]
      .map((e) => String(e ?? "").trim().toLowerCase()).filter(Boolean)
  ));
  const ccDefaultFor = (toEmail?: string | null) => {
    const to = String(toEmail ?? "").trim().toLowerCase();
    return caseCcEmails.filter((e) => e !== to).join(", ");
  };
  const clientToInit = (dJob?.to ?? "") || (job?.contact_email ?? "") || (extractReplyEmail(job?.detail ?? job?.description) ?? "");
  const candToInit   = (dCand?.to ?? "") || cand?.email || cand?.contact_email || (extractReplyEmail(cand?.note ?? cand?.exp) ?? "");
  const [clientForm, setClientForm] = useState<MailForm>(() => ({
    // 送信先：下書き → 案件の contact_email → 取込元本文(detail)から抽出 の順で解決。
    email: clientToInit,
    // CC：下書き → 案件先担当者（案件窓口/企業窓口・宛先と重複は除外）。
    cc: (dJob?.cc ?? "") || ccDefaultFor(clientToInit),
    subject: (dJob?.subject ?? "") || buildJobMailSubject(job),
    body: (dJob?.body ?? "") || buildJobMailContent(job, cand),
  }));
  const [candForm, setCandForm] = useState<MailForm>(() => ({
    // 送信先：下書き → 人材の email/contact_email（SES窓口）→ 取込元本文(note)から抽出 の順。
    //   CSV取込・旧データで窓口メールが未登録でも、元メール本文から返信先を拾って送れるようにする。
    email: candToInit,
    // CC：人材側メールには案件先担当者を自動挿入しない。
    //   人材（パートナーSES）側に案件先のメアドが漏れると、企業情報の取り扱い意図に
    //   反するため、デフォルトは下書きの CC のみ（=通常は空）。
    cc: (dCand?.cc ?? ""),
    // 下書きに旧固定文言（LEGACY_CAND_SUBJECT）が保存されている場合は無視して再計算する
    //   （PR #366 以降は「Re: <案件名>」がフォールバックの正解。旧下書きを救済）。
    subject: (() => {
      const saved = (dCand?.subject ?? "").trim();
      if (saved && saved !== LEGACY_CAND_SUBJECT) return saved;
      return buildCandMailSubject(cand);
    })(),
    body: (dCand?.body ?? "") || buildCandMailContent(job, cand),
  }));
  const [clientErrors, setClientErrors] = useState<MailErrors>({});
  const [candErrors, setCandErrors] = useState<MailErrors>({});
  // 1メールに複数案件が記載されている場合の「提案する案件」選択。
  //   案件側マッチングは元メール全文(detail)で判定するため当たるが、提案文の【案件名】は
  //   1案件目固定だった。ここで元メールを案件分割し、人材スキルに最も合う案件を既定選択＋切替可にする。
  const [subJobs, setSubJobs] = useState<{ title: string; skills: string[] }[]>([]);
  const [subJobIdx, setSubJobIdx] = useState<number>(0);
  const [subJobLoading, setSubJobLoading] = useState(false);
  const [initialized, setInitialized] = useState(true); // 初期値で済んでいるので true で開始
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(initialSaved && !rejected);
  const [_savedId, setSavedId] = useState<string | null>(initialSavedId);
  const [jobToken, setJobToken] = useState<string | null>(null);
  const [candToken, setCandToken] = useState<string | null>(null);
  // 既に「📋 提案する」(recordProposal) で記録済みの提案を再度開いた場合、
  // DB に保存されたトークンを必ずメール本文へ反映する。ここで取得しないと、
  // メールに焼き込まれるリンクのトークンが DB と一致せず「リンク切れ」になる。
  useEffect(() => {
    if (!initialSaved || !initialSavedId) return;
    if (jobToken && candToken) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await getProposalTokens(initialSavedId);
        if (cancelled || !r.ok) return;
        if (r.jobToken)  setJobToken(r.jobToken);
        if (r.candToken) setCandToken(r.candToken);
      } catch { /* fail-soft：下の防御策でローカル生成にフォールバック */ }
    })();
    return () => { cancelled = true; };
  }, [initialSaved, initialSavedId, jobToken, candToken]);
  // 下書き(pending_mail)は通常はサーバ側(mail-compose page)が initialDraft として渡す。
  //   ただしマッチング画面の「📤 送信する」(SendMailModalButton)経由では initialDraft が無い。
  //   承認後は提案が承認タブから外れ、依頼者はこの経路で送信するため、下書きが定型文に
  //   戻って消えて見える問題があった。initialDraft が無く既存提案がある場合は、ここで
  //   getProposalDraft を取得してフォームへ反映する（1回だけ）。
  const [draftLoaded, setDraftLoaded] = useState(!!initialDraft);
  useEffect(() => {
    if (draftLoaded || !initialSavedId) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await getProposalDraft(initialSavedId);
        if (cancelled || !r.ok || !r.mail) { setDraftLoaded(true); return; }
        const j = r.mail.job ?? {}; const c = r.mail.cand ?? {};
        setClientForm((prev) => ({
          email:   typeof j.to === "string" && j.to ? j.to : prev.email,
          cc:      typeof j.cc === "string" ? j.cc : prev.cc,
          subject: typeof j.subject === "string" && j.subject ? j.subject : prev.subject,
          body:    typeof j.body === "string" && j.body ? j.body : prev.body,
        }));
        setCandForm((prev) => ({
          email:   typeof c.to === "string" && c.to ? c.to : prev.email,
          cc:      typeof c.cc === "string" ? c.cc : prev.cc,
          // 旧下書きに保存された固定件名(LEGACY)は無視し、算出済みの実件名（Re: <元件名>）を維持する。
          //   保存値で上書きすると、確認画面のプレビュー件名が実送信(Re:)と食い違う原因になる。
          subject: typeof c.subject === "string" && c.subject && c.subject.trim() !== LEGACY_CAND_SUBJECT ? c.subject : prev.subject,
          body:    typeof c.body === "string" && c.body ? c.body : prev.body,
        }));
      } catch { /* fail-soft：取れなければ定型文のまま */ }
      finally { if (!cancelled) setDraftLoaded(true); }
    })();
    return () => { cancelled = true; };
  }, [initialSavedId, draftLoaded]);
  // 人材側の件名補正：元メール(source_mail_url)が存在するのに source_mail_subject 未取得で
  //   定型件名(LEGACY)に落ちている場合、受信箱(inbox_emails)から元件名を引いて「Re: <元件名>」に
  //   差し替える。スレッド連結は source_mail_url で行われる一方、件名は source_mail_subject 依存
  //   だったため、元メールがあっても定型件名が表示・送信される不具合への対応（表示＝実送信に一致）。
  useEffect(() => {
    if (!draftLoaded) return;                       // 下書き反映後に判定（保存件名を尊重）
    if (!cand?.source_mail_url) return;             // 元メールが無ければ定型のままで正しい
    if (candForm.subject.trim() !== LEGACY_CAND_SUBJECT) return; // 既に実件名があるなら触らない
    let cancelled = false;
    (async () => {
      try {
        const r = await getSourceMailSubject(cand.source_mail_url);
        if (cancelled || !r.ok || !r.subject) return;
        const next = buildCandMailSubject({ source_mail_subject: r.subject }); // 「Re: <元件名>」
        setCandForm((prev) => (prev.subject.trim() === LEGACY_CAND_SUBJECT ? { ...prev, subject: next } : prev));
      } catch { /* 解決できなければ定型のまま */ }
    })();
    return () => { cancelled = true; };
  }, [draftLoaded, cand?.source_mail_url]); // eslint-disable-line react-hooks/exhaustive-deps
  // 防御策：step=2（プレビュー段階）に到達してもトークンが無いなら、ローカル生成して
  // 必ずボタン HTML を作る。送信時に createProposal(preTokens) 経由で DB と同期される。
  //   ※ 既存提案(initialSavedId)の場合は getProposalTokens が self-heal で必ず DB のトークンを
  //     返すので、その応答待ち。ここで先にローカル生成して送信すると DB と一致せず
  //     「リンク切れ」になる過去事故があったため避ける。
  useEffect(() => {
    if (step !== 2) return;
    if (initialSavedId) return;
    if (!jobToken)  setJobToken(generateToken());
    if (!candToken) setCandToken(generateToken());
  }, [step, jobToken, candToken, initialSavedId]);
  const [msg, setMsg] = useState<string | null>(null);
  // 新フロー：メール送信は承認者が提案管理から行うため、Wizard 側から送信モーダルは開かない。
  // ただし admin / マネージャー / リーダーは承認スキップで自分が直接送信できる。
  const [privileged, setPrivileged] = useState<boolean | null>(null); // 取得中=null, true=権限あり
  const [autoOpenSend, setAutoOpenSend] = useState(false);
  useEffect(() => { isProposerPrivileged().then((r) => setPrivileged(!!r.privileged)).catch(() => setPrivileged(false)); }, []);

  // 承認者が提案管理の「メール内容を確認して送信」から別タブで開いた直後（?send=1）は、
  // 確認ステップ(2)へ即時遷移して「メールを送信（案件側・人材側）」モーダルを自動オープンする。
  // 承認＋ステージ進行は親画面側（ApproveAndSendButton）で先に確定済み。
  const searchParams = useSearchParams();
  useEffect(() => {
    if (searchParams?.get("send") === "1") { setStep(2); setAutoOpenSend(true); }
    // 初回マウント時のみ評価する（途中で URL を変えるユースケースは無い）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 権限者用：承認者選択なしで保存→送信モーダル自動オープン
  const handleSelfApproveAndSend = async () => {
    if (job?.job_no == null || cand?.candidate_no == null) { setMsg("保存できません（ID不足）"); return; }
    if (!(proposer ?? "").trim()) { setMsg("担当者（提案者）を選択してください"); return; }
    const fm = flowMatchMatrix(job ?? {}, cand ?? {});
    if (fm.compat === "ng") {
      const ok = window.confirm(`⚠ 商流NGの可能性\n\n案件の受入：${JOB_FLOW_LABEL[fm.jobCat]}\n人材の所属：${CAND_FLOW_LABEL[fm.candCat]}\n\nこのまま送信を進めますか？`);
      if (!ok) { setMsg("商流NGのため送信を中止しました"); return; }
    }
    setSaving(true); setMsg(null);
    // 権限者は pending_mail に下書き保存不要（直接送信するため）。トークンだけ保存される。
    try {
      const res = await createProposal(
        job.job_no, cand.candidate_no, score, proposer || undefined,
        { jobToken, candToken },
        "",  // approver空：サーバ側で権限者と判定し承認スキップ＋所属確認で作成
      );
      if (res.ok) {
        setSaved(true); setSavedId(res.id ?? null);
        setMsg(res.existed ? "既存提案を更新しました。メール送信を開きます。" : "提案を作成しました。メール送信を開きます。");
        setAutoOpenSend(true);  // SendBothMailsButton を自動オープン
      } else setMsg(res.error || "保存に失敗しました");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "保存に失敗しました");
    } finally { setSaving(false); }
  };

  // 元メールリンク：保存済みメッセージIDが無効/未登録の場合でも開けるよう、
  // 関連キーワード(会社名・案件名・人材名)で Gmail 検索URLにフォールバックする。
  const jobOrigUrl = gmailMessageUrl(job?.source_mail_url)
    || gmailSearchUrl([job?.client_name, job?.title].filter(Boolean).join(" "))
    || null;
  const candOrigUrl = gmailMessageUrl(cand?.source_mail_url)
    || (cand?.name ? gmailSearchUrl([cand?.source_company, cand?.name].filter(Boolean).join(" ")) : null);

  // 送信時のスレッド連結用：元メール(受信箱)の Gmail Message-ID を source_mail_url から抽出。
  //   16進ID単体・Gmail URL末尾の #all/<id>・?th=<id> のいずれにも対応する。
  //   抽出できなければ null（新規メールとして送信される）。
  const extractGmailId = (v?: string | null): string | null => {
    if (!v) return null;
    const s = String(v).trim().replace(/^["']+|["']+$/g, "");
    if (!s) return null;
    if (/^[0-9a-f]{8,}$/i.test(s)) return s;
    const m = s.match(/[/#?&](?:th=|all\/|inbox\/|sent\/)?([0-9a-f]{12,})(?:[/?&]|$)/i);
    return m?.[1] ?? null;
  };
  const jobOrigGmailId = extractGmailId(job?.source_mail_url);
  const candOrigGmailId = extractGmailId(cand?.source_mail_url);

  // 初期値で本文をセット済みのため、フォーム初期化用の useEffect は不要。

  const updateClientForm = (field: keyof MailForm, v: string) => {
    setClientForm((prev) => ({ ...prev, [field]: v }));
    setClientErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  // 本文中の「【案件名】：…」行を、選択した案件名に差し替える（本文の他の編集は保持）。
  const applyFeaturedJobTitle = (title: string) => {
    const t = String(title ?? "").trim();
    if (!t) return;
    setClientForm((prev) => {
      const line = `【案件名】：　${t}`;
      const body = /【案件名】[：:].*/.test(prev.body)
        ? prev.body.replace(/【案件名】[：:].*/, line)
        : prev.body;
      return { ...prev, body };
    });
  };

  // 1メールに複数案件があるか判定 → 分割 → 人材スキルに最も合う案件を既定選択。
  useEffect(() => {
    const detail = String(job?.detail ?? job?.description ?? "");
    if (!detail) return;
    // 軽量ゲート：複数案件っぽい時だけ AI 分割を呼ぶ（単一案件で無駄に課金しない）。
    const multiHint =
      /案件\s*[②-⑨2-9]/.test(detail) ||
      (detail.match(/【\s*案件名/g)?.length ?? 0) >= 2 ||
      (detail.match(/■\s*案件/g)?.length ?? 0) >= 2 ||
      /[2-9]\s*件|複数案件/.test(String(job?.title ?? ""));
    if (!multiHint) return;
    let cancelled = false;
    setSubJobLoading(true);
    (async () => {
      try {
        const res = await fetch("/api/extract-bulk", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: detail, kind: "jobs" }),
        });
        const data = await res.json();
        if (cancelled || !data.ok) return;
        const recs: any[] = Array.isArray(data.records) ? data.records : [];
        const jobs = recs
          .map((r) => ({ title: String(r.title ?? "").trim(), skills: Array.isArray(r.skills) ? r.skills.map((s: any) => String(s ?? "").trim()).filter(Boolean) : [] }))
          .filter((j) => j.title);
        if (jobs.length < 2) return; // 1件なら従来どおり
        // 人材スキルとの一致数が最大の案件を既定に。
        const norm = (s: string) => s.toLowerCase().replace(/[\s.・\-_／/]/g, "");
        const candSet = new Set((Array.isArray(cand?.skills) ? cand.skills : []).map((s: any) => norm(String(s ?? ""))));
        const score = (sk: string[]) => sk.reduce((n, s) => n + (candSet.has(norm(s)) ? 1 : 0), 0);
        let bestIdx = 0, bestScore = -1;
        jobs.forEach((j, i) => { const sc = score(j.skills); if (sc > bestScore) { bestScore = sc; bestIdx = i; } });
        setSubJobs(jobs);
        setSubJobIdx(bestIdx);
        // 既定案件を本文に反映（1案件目固定だった【案件名】を、合う案件に直す）。
        applyFeaturedJobTitle(jobs[bestIdx].title);
      } catch { /* 分割失敗時は従来どおり単一案件で続行 */ }
      finally { if (!cancelled) setSubJobLoading(false); }
    })();
    return () => { cancelled = true; };
    // job/cand はマウント時固定。初回のみ実行。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateCandForm = (field: keyof MailForm, v: string) => {
    setCandForm((prev) => ({ ...prev, [field]: v }));
    setCandErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const handleNext = () => {
    if (!(proposer ?? "").trim()) { setMsg("担当者（提案者）を選択してください"); return; }
    const clientOk = validateSide(clientForm, setClientErrors, "案件側");
    const candOk = validateSide(candForm, setCandErrors, "人材側");
    if (!clientOk || !candOk) return;
    if (!jobToken)  setJobToken(generateToken());
    if (!candToken) setCandToken(generateToken());
    setStep(2);
  };

  // 「📨 承認申請」：メール本文・宛先を pending_mail として保存する。送信は承認者が行う。
  const handleRequestApproval = async () => {
    if (job?.job_no == null || cand?.candidate_no == null) { setMsg("保存できません（ID不足）"); return; }
    const fm = flowMatchMatrix(job ?? {}, cand ?? {});
    if (fm.compat === "ng") {
      const ok = window.confirm(
        `⚠ 商流NGの可能性\n\n案件の受入：${JOB_FLOW_LABEL[fm.jobCat]}\n人材の所属：${CAND_FLOW_LABEL[fm.candCat]}\n\nこのまま申請を進めますか？`
      );
      if (!ok) { setSaving(false); setMsg("商流NGのため申請を中止しました"); return; }
    }
    if (!(proposer ?? "").trim()) { setMsg("担当者（提案者）を選択してください"); return; }
    const approverName = (approver ?? "").trim();
    if (!approverName) { setMsg("承認者を選択してください"); return; }
    if ((proposer ?? "").trim() === approverName) { setMsg("承認者は提案者と別の人を選んでください"); return; }
    setSaving(true); setMsg(null);
    // メール下書きを保存：承認者が「✓ 承認して送信」したときに、この内容＋トークンから送信される。
    const pendingMail = {
      job:  { to: clientForm.email, cc: clientForm.cc || "", subject: clientForm.subject, body: clientForm.body },
      cand: { to: candForm.email,   cc: candForm.cc   || "", subject: candForm.subject,   body: candForm.body   },
    };
    try {
      const res = await createProposal(
        job.job_no, cand.candidate_no, score, proposer || undefined,
        { jobToken, candToken },
        approverName,
        pendingMail,
      );
      if (res.ok) {
        setSaved(true); setSavedId(res.id ?? null);
        if (rejected) {
          // 差戻し後の再申請：承認待ちへ戻して再通知済み。
          setMsg(`再申請しました。${approverName}さんがメール内容を確認し、承認して送信します。`);
        } else if (res.existed) {
          setJobToken(null);
          setCandToken(null);
          setMsg(`既に提案済みです。メール下書きを更新しました（${approverName}さんが承認して送信します）`);
        } else {
          setMsg(`承認申請しました。${approverName}さんがメール内容を確認し、承認して送信します。`);
        }
      } else {
        setMsg(res.error || "保存に失敗しました");
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "保存に失敗しました");
    } finally { setSaving(false); }
  };

  // メール本文の「話を進める／見送り」リンクの base URL。
  //   ① 環境変数 NEXT_PUBLIC_SITE_URL を最優先（運用上の正規ドメインを固定する）。
  //   ② 未設定時は window.location.origin。ただし *.vercel.app の Preview URL は
  //      再デプロイで消えて受信者がボタンを押すと「リンク切れ」になるため、本番
  //      ドメイン dx.enger.jp に強制置換する（過去にこの事故があった）。
  const siteUrl = (() => {
    const env = (process.env.NEXT_PUBLIC_SITE_URL ?? "").trim().replace(/\/$/, "");
    if (env) return env;
    if (typeof window === "undefined") return "https://dx.enger.jp";
    const origin = window.location.origin;
    try {
      const host = new URL(origin).hostname;
      if (/\.vercel\.app$/i.test(host)) return "https://dx.enger.jp";
    } catch { /* ignore */ }
    return origin;
  })();
  const jobButtonHtml  = jobToken  ? buildButtonHtml(siteUrl, jobToken)  : null;
  const candButtonHtml = candToken ? buildButtonHtml(siteUrl, candToken) : null;

  const jobBadge = (job.client_name ?? "").slice(0, 10) || "企業";
  const candBadge = cand.name || cand.initials || "人材";
  const backUrl = `/matching?job=${job.job_no}&cand=${cand.candidate_no}`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Header bar */}
      <div className="card" style={{ padding: "16px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
        <div className="muted" style={{ fontSize: 11.5 }}>
          {job.title} <span style={{ opacity: 0.4 }}>×</span> {cand.name}
        </div>
        <StepBar current={step} />
        {/* 担当者（提案者）：必須。選んだ人がそのまま提案管理の「提案者」として保存される（双方向に連動）。
            選択肢は実際の提案者リスト（members）。未選択では先へ進めない（承認者と同様に必須）。 */}
        <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--color-ink-3)", marginTop: 2 }}
          title="このメール（提案）の担当者（必須）。選んだ人が提案管理の「提案者」になります。">
          担当者（提案者）<span style={{ color: "var(--color-danger)" }}>*</span>
          <select value={proposer} onChange={(e) => setProposer(e.target.value)}
            style={{ fontFamily: "inherit", fontSize: 12.5, padding: "5px 10px", borderRadius: 6, border: `1px solid ${proposer ? "var(--color-border-strong)" : "var(--color-danger)"}`, background: "var(--color-surface)", minWidth: 160 }}>
            <option value="">— 選択 —</option>
            {members.filter(Boolean).map((m) => <option key={m} value={m}>{m}</option>)}
            {proposer && !members.includes(proposer) && <option value={proposer}>{proposer}</option>}
          </select>
        </label>
      </div>

      {step === 1 && (
        <>
          {(subJobLoading || subJobs.length >= 2) && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "10px 14px", marginBottom: 12, border: "1px solid var(--color-brand-200, #cfe1f7)", background: "var(--color-brand-25, #f0f6ff)", borderRadius: 10 }}>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--color-brand-700, #0b5cab)" }}>📑 この元メールには複数案件があります</span>
              {subJobLoading ? (
                <span className="muted" style={{ fontSize: 12 }}>案件を分割中…</span>
              ) : (
                <>
                  <label style={{ fontSize: 12, color: "var(--color-ink-3)", display: "inline-flex", alignItems: "center", gap: 6 }}>
                    提案する案件
                    <select value={subJobIdx}
                      onChange={(e) => { const i = Number(e.target.value); setSubJobIdx(i); applyFeaturedJobTitle(subJobs[i]?.title ?? ""); }}
                      style={{ fontSize: 12.5, padding: "5px 10px", borderRadius: 6, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", maxWidth: 420 }}>
                      {subJobs.map((j, i) => (
                        <option key={i} value={i}>{`${i + 1}. ${j.title}`}{j.skills.length ? `（${j.skills.slice(0, 4).join("・")}）` : ""}</option>
                      ))}
                    </select>
                  </label>
                  <span className="muted" style={{ fontSize: 11 }}>※ 人材スキルに最も合う案件を既定で選択。本文の【案件名】に反映されます。</span>
                </>
              )}
            </div>
          )}
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
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <Link href={backUrl} className="btn ghost" style={{ textDecoration: "none" }}>キャンセル</Link>
            {/* メンバー（権限者でない）は編集画面からも直接「承認申請」を出せるようにする。
                以前は確認画面まで進まないと承認申請ボタンに辿り着けず、メンバーが詰まる事故が起きていた。
                既に承認済みのとき（recordProposal等で approved 扱いになっている等）は申請不要のためボタンは隠す。 */}
            {!privileged && !approved && (
              <div style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--color-ink-3)" }}
                  title="承認者（必須）。選んだ人が提案ボードで承認するまで「承認待ち」になります。">
                  承認者
                  <select value={approver} onChange={(e) => setApprover(e.target.value)} disabled={saving}
                    style={{ fontFamily: "inherit", fontSize: 12, padding: "5px 8px", borderRadius: 6, border: `1px solid ${approver ? "var(--color-border-strong)" : "var(--color-danger)"}`, background: "var(--color-surface)", minWidth: 130 }}>
                    <option value="">— 選択 —</option>
                    {members.filter((m) => m && m !== proposer).map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </label>
                <button type="button" className="btn" onClick={handleRequestApproval}
                  disabled={saving || !approver || !proposer}
                  title={!proposer ? "先に担当者（提案者）を選択してください" : !approver ? "先に承認者を選択してください" : `${approver}さんに承認申請します`}
                  style={{ fontWeight: 700 }}>
                  {saving ? "処理中…" : "📨 承認申請"}
                </button>
              </div>
            )}
            <button type="button" className="btn brand" onClick={handleNext} disabled={!proposer}
              title={!proposer ? "先に担当者（提案者）を選択してください" : undefined}>確認画面へ →</button>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          {rejected && !saved && (
            <div style={{ fontSize: 12.5, fontWeight: 700, color: "#b42318", background: "#fdecef", border: "1px solid #f7c5cf", borderRadius: 8, padding: "10px 14px", textAlign: "center" }}>
              🔴 この提案は差し戻されました。内容を修正のうえ、承認者を選んで「📨 承認申請」で再申請してください。
            </div>
          )}
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
          {/* メインの操作行：
              ・通常エージェント（権限なし）：承認者を選んで「📨 承認申請」（メール送信は承認者が行う）
              ・admin/マネージャー/リーダー   ：承認スキップで「📨 メールを送信」を直接押せる */}
          <div style={{ display: "flex", justifyContent: "center", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            {!saved && !privileged && (
              <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--color-ink-3)" }}
                title="承認者（必須）：選んだ人が提案ボードで承認するまで「承認待ち」になります">
                承認者
                <select value={approver} onChange={(e) => setApprover(e.target.value)} disabled={saving}
                  style={{ fontFamily: "inherit", fontSize: 12.5, padding: "5px 8px", borderRadius: 6, border: `1px solid ${approver ? "var(--color-border-strong)" : "var(--color-danger)"}`, background: "var(--color-surface)", minWidth: 130 }}>
                  <option value="">— 選択 —</option>
                  {members.filter((m) => m && m !== proposer).map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </label>
            )}
            {!saved ? (
              privileged ? (
                <button type="button" className="btn brand" onClick={handleSelfApproveAndSend}
                  disabled={saving || privileged === null || !proposer}
                  title={!proposer ? "先に担当者（提案者）を選択してください" : "承認スキップで直接送信します（管理者/マネージャー/リーダー権限）"}
                  style={{ fontWeight: 800 }}>
                  {saving ? "処理中…" : "📨 メールを送信"}
                </button>
              ) : (
                <button type="button" className="btn brand" onClick={handleRequestApproval}
                  disabled={saving || !approver || !proposer}
                  title={!proposer ? "先に担当者（提案者）を選択してください" : !approver ? "先に承認者を選択してください" : `${approver}さんに承認申請します。メール送信は承認者が行います`}
                  style={{ fontWeight: 800 }}>
                  {saving ? "処理中…" : "📨 承認申請"}
                </button>
              )
            ) : (
              // 権限者、または承認済みの提案は、この画面から直接送信できる。
              (privileged || approved) ? (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                  {approved && !privileged && (
                    <span style={{ fontSize: 12, fontWeight: 700, color: "#067647" }}>✅ 承認済みです。メールを送信できます。</span>
                  )}
                  <SendBothMailsButton
                    label="📨 メールを送信"
                    className="btn brand"
                    autoOpen={autoOpenSend}
                    onAutoOpened={() => setAutoOpenSend(false)}
                    jobSide={{
                      label: "案件側メール", dotColor: "#ef4444",
                      to: clientForm.email, cc: clientForm.cc, subject: clientForm.subject, body: clientForm.body,
                      buttonHtml: jobButtonHtml ?? undefined,
                      relatedKind: "proposal_job",
                      relatedId: _savedId ?? (job.job_no != null ? String(job.job_no) : undefined),
                      originalGmailId: jobOrigGmailId,
                    }}
                    candSide={{
                      label: "人材側メール", dotColor: "#3b82f6",
                      to: candForm.email, cc: candForm.cc, subject: candForm.subject, body: candForm.body,
                      buttonHtml: candButtonHtml ?? undefined,
                      relatedKind: "proposal_cand",
                      relatedId: _savedId ?? (cand.candidate_no != null ? String(cand.candidate_no) : undefined),
                      originalGmailId: candOrigGmailId,
                    }}
                  />
                </div>
              ) : (
                <span className="muted" style={{ fontSize: 12, color: "var(--color-ink-3)" }}>
                  ✉️ 承認待ちです。承認されると、この画面の「メールを送信」ボタンから送信できます（承認者も提案管理から送信できます）。
                </span>
              )
            )}
          </div>
          {/* 補助操作（編集に戻る・次の導線）は下段に控えめに配置 */}
          <div style={{ display: "flex", justifyContent: "center", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" className="btn ghost" onClick={() => setStep(1)}>← 編集に戻る</button>
            {saved && !approved && !privileged && (
              <span className="btn" style={{ cursor: "default", color: "#1aa260", borderColor: "#bfe3cc", background: "#eef8f1", fontWeight: 700 }}>✓ 承認に出し済み</span>
            )}
            {saved && (
              <>
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
              </>
            )}
          </div>
          {msg && <div style={{ fontSize: 12, color: saved && !msg.includes("既に") ? "#067647" : "var(--color-danger)", textAlign: "center" }}>{msg}</div>}
        </>
      )}
    </div>
  );
}
