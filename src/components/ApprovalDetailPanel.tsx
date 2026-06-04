"use client";

// 承認画面の各アカウント詳細パネル：
//   - メールひな型（welcome / 面談依頼 / リマインド / 承認 / 見送り）から本文を生成
//   - 「Gmailで開く＋送信履歴に記録」ボタンで Gmail を開きつつ DB に履歴を残す
//   - 面談予定の追加（meetings に紐づけ）
//   - 過去の送信履歴・打合せ履歴を表示
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { buildEmail, TEMPLATE_LABEL, type EmailTemplate } from "@/lib/account-emails";
import { logAccountEmail, createAccountMeeting } from "@/app/settings/account-actions";
import { gmailComposeUrl } from "@/lib/gmail";

const fmtDateTime = (s?: string | null) => { if (!s) return "—"; const d = new Date(s); return isNaN(d.getTime()) ? "—" : `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

export function ApprovalDetailPanel({ account, emails, meetings, meetingUrl }: {
  account: any;
  emails: any[];
  meetings: any[];
  meetingUrl?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [template, setTemplate] = useState<EmailTemplate>("welcome");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [meetingDate, setMeetingDate] = useState("");
  const [meetingNote, setMeetingNote] = useState("");

  // テンプレ切替時に件名/本文を再生成
  useEffect(() => {
    const e = buildEmail({ template, role: account.role, name: account.name, companyName: account.company_name, meetingUrl, agentName: (account as any).owner_agent_name });
    setSubject(e.subject); setBody(e.body);
  }, [template, account.id, account.role, account.name, account.company_name, meetingUrl]);

  const composeUrl = useMemo(() => gmailComposeUrl({ to: account.email, subject, body }), [subject, body, account.email]);

  const sendAndLog = () => {
    if (!subject.trim() || !body.trim()) { setMsg({ ok: false, text: "件名と本文を入力してください" }); return; }
    // 新しいタブで Gmail を開く
    try { window.open(composeUrl, "_blank", "noopener"); } catch { /* noop */ }
    start(async () => {
      const res = await logAccountEmail({ account_id: account.id, account_email: account.email, template, subject, body });
      if (res.ok) { setMsg({ ok: true, text: "Gmailを開き、送信履歴に記録しました" }); router.refresh(); }
      else setMsg({ ok: false, text: res.error || "履歴の保存に失敗しました" });
    });
  };

  const scheduleMeeting = () => {
    if (!meetingDate) { setMsg({ ok: false, text: "面談日を入力してください" }); return; }
    start(async () => {
      const res = await createAccountMeeting({ account_id: account.id, account_email: account.email, meeting_date: meetingDate, needs: meetingNote || undefined });
      if (res.ok) { setMsg({ ok: true, text: "打合せ予定を登録しました（打合せ記録にも反映）" }); setMeetingDate(""); setMeetingNote(""); router.refresh(); }
      else setMsg({ ok: false, text: res.error || "打合せ登録に失敗しました" });
    });
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
      {/* 左：メール送信 */}
      <div style={{ border: "1px solid var(--color-border)", borderRadius: 10, padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 800 }}>📧 メール送信（ひな型）</div>
          <select value={template} onChange={(e) => setTemplate(e.target.value as EmailTemplate)}
            style={{ fontFamily: "inherit", fontSize: 11.5, padding: "4px 8px", borderRadius: 6, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)" }}>
            {(Object.keys(TEMPLATE_LABEL) as EmailTemplate[]).map((k) => <option key={k} value={k}>{TEMPLATE_LABEL[k]}</option>)}
          </select>
        </div>
        <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)}
          style={{ fontFamily: "inherit", fontSize: 12.5, padding: "6px 8px", borderRadius: 7, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)" }} />
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={9}
          style={{ fontFamily: "var(--font-sans)", fontSize: 12, lineHeight: 1.7, padding: 10, borderRadius: 8, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", resize: "vertical" }} />
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button type="button" className="btn brand btn-xs" disabled={pending || !account.email} onClick={sendAndLog}>
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>mail</span>
            <span>Gmailで開いて履歴に記録</span>
          </button>
          {!account.email && <span style={{ fontSize: 11, color: "var(--color-danger)" }}>※ メールアドレスがありません</span>}
        </div>

        <div style={{ borderTop: "1px solid var(--color-border)", paddingTop: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>送信履歴（{emails.length}件）</div>
          {emails.length === 0 ? <div className="muted" style={{ fontSize: 11.5 }}>まだ送信履歴はありません</div> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 160, overflowY: "auto" }}>
              {emails.map((e: any) => (
                <details key={e.id} style={{ border: "1px solid var(--color-border)", borderRadius: 6, padding: "5px 8px" }}>
                  <summary style={{ fontSize: 11.5, cursor: "pointer", display: "flex", gap: 6 }}>
                    <span className="tag" style={{ fontSize: 9.5, padding: "1px 6px" }}>{TEMPLATE_LABEL[e.template as EmailTemplate] ?? e.template}</span>
                    <span style={{ minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.subject}</span>
                    <span className="muted" style={{ fontSize: 10, flexShrink: 0 }}>{fmtDateTime(e.created_at)}</span>
                  </summary>
                  <div style={{ fontSize: 11, color: "var(--color-ink-3)", whiteSpace: "pre-wrap", marginTop: 6, lineHeight: 1.7 }}>{e.body}</div>
                  {e.actor_email && <div className="muted" style={{ fontSize: 10, marginTop: 4 }}>送信者：{e.actor_name ?? e.actor_email}</div>}
                </details>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 右：面談予定＋履歴 */}
      <div style={{ border: "1px solid var(--color-border)", borderRadius: 10, padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 800 }}>📅 面談予定（打合せ記録と連動）</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          <input type="date" value={meetingDate} onChange={(e) => setMeetingDate(e.target.value)}
            style={{ fontFamily: "inherit", fontSize: 12.5, padding: "6px 8px", borderRadius: 7, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)" }} />
          <input type="text" value={meetingNote} onChange={(e) => setMeetingNote(e.target.value)} placeholder="ヒアリングしたい内容（任意）"
            style={{ fontFamily: "inherit", fontSize: 12.5, padding: "6px 8px", borderRadius: 7, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)" }} />
        </div>
        <button type="button" className="btn brand btn-xs" disabled={pending} onClick={scheduleMeeting} style={{ alignSelf: "flex-start" }}>
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>event</span><span>面談予定を登録</span>
        </button>
        <div style={{ fontSize: 10.5, color: "var(--color-ink-4)" }}>※ 登録すると「打合せ記録」にも自動で連動します。面談後に「面談済みにする」を押すと詳細が解放されます。</div>

        <div style={{ borderTop: "1px solid var(--color-border)", paddingTop: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>打合せ履歴（{meetings.length}件）</div>
          {meetings.length === 0 ? <div className="muted" style={{ fontSize: 11.5 }}>まだ打合せ履歴はありません</div> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 160, overflowY: "auto" }}>
              {meetings.map((m: any) => (
                <div key={m.id} style={{ border: "1px solid var(--color-border)", borderRadius: 6, padding: "6px 8px", fontSize: 11.5 }}>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <span style={{ fontWeight: 700 }}>{m.meeting_date ?? "—"}</span>
                    {m.fb_sentiment && <span className="tag" style={{ fontSize: 9.5, padding: "1px 6px" }}>{m.fb_sentiment}</span>}
                    <span className="muted" style={{ fontSize: 10, marginLeft: "auto" }}>{m.our_owner ?? ""}</span>
                  </div>
                  <div style={{ marginTop: 3, color: "var(--color-ink-3)" }}>{m.title ?? ""}</div>
                  {m.ai_summary && <div className="muted" style={{ fontSize: 10.5, marginTop: 3 }}>{m.ai_summary}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {msg && <div style={{ gridColumn: "1 / -1", fontSize: 12.5, color: msg.ok ? "var(--color-success)" : "var(--color-danger)" }}>{msg.text}</div>}
    </div>
  );
}
