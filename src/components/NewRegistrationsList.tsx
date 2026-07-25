"use client";

// 「新着」タブの一覧（企業管理＝エンジャービジネス経由の企業、マッチング＝エンジャーフリーランス経由の人材）。
//   ・app_users の承認待ち（client/partner または candidate/freelance）
//   ・LP 仮想行（profiles / auth.users にだけ居る登録。id が profile:/auth: で始まる）
//   ・LP登録エントリー（entry:＝coo_talent_entries）
//   をまとめて表示し、その場で「面談」チェック（＝承認＋本登録＋全機能解放）・削除できる。
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "@/components/AppLink";
import type { Account } from "@/lib/accounts";
import { deleteAccount, bulkDeleteAccounts, rejectTalentEntry, approveNewcomerAsMeeting } from "@/app/settings/account-actions";
import { prepareCandidateFromFreelancer, type FreelancePrefill } from "@/app/engineers/actions";
import { sourceMeta, sourceBgFor } from "@/lib/signup-sources";

const isLpVirtual = (id: string) => id.startsWith("profile:") || id.startsWith("auth:");
const isEntry = (id: string) => id.startsWith("entry:");
// profile:/auth: の接頭辞を外して engineer(profiles.id) を得る。
const engineerIdOf = (id: string) =>
  id.startsWith("profile:") ? id.slice("profile:".length) : id.startsWith("auth:") ? id.slice("auth:".length) : "";

const fmtDateTime = (s?: string | null) => { if (!s) return "—"; const d = new Date(s); return isNaN(d.getTime()) ? "—" : `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

export function NewRegistrationsList({ rows, kind }: { rows: Account[]; kind: "company" | "talent" }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; candidateNo?: number } | null>(null);
  // ① スキルシート・モーダル
  const [sheetFor, setSheetFor] = useState<Account | null>(null);
  const [sheet, setSheet] = useState<FreelancePrefill | null>(null);
  const [sheetBusy, setSheetBusy] = useState(false);
  const [sheetErr, setSheetErr] = useState<string | null>(null);

  const noun = kind === "company" ? "企業" : "人材";
  const run = (id: string, fn: () => Promise<{ ok: boolean; error?: string; candidate_no?: number }>, okText: string) => {
    setBusyId(id); setMsg(null);
    start(async () => {
      const res = await fn();
      setBusyId(null);
      // 0725：本登録で P 番号が確定したら、成功メッセージに「マッチングへ」直行リンクを出す
      //   （登録 → 面談チェック → その場でマッチング実行、の一連の流れを画面遷移1回に短縮）。
      if (res.ok) { setMsg({ ok: true, text: okText, candidateNo: res.candidate_no }); router.refresh(); }
      else setMsg({ ok: false, text: res.error || "操作に失敗しました" });
    });
  };

  // ②③ 面談チェック＝承認＋本登録（マッチング対象化）＋全機能解放。
  const doMeeting = (a: Account) => {
    run(a.id, () => approveNewcomerAsMeeting({ id: a.id, email: a.email, name: a.name, role: a.role, company_name: a.company_name }),
      isEntry(a.id) ? `${a.name || a.email} を取り込みました（マッチング対象に反映）` : `${a.name || a.email} を面談済で本登録しました（全機能・マッチング対象に反映）`);
  };
  const doDelete = (a: Account) => {
    const verb = isEntry(a.id) ? "却下" : "削除";
    if (!confirm(`${a.email} の登録を${verb}しますか？この操作は取り消せません。`)) return;
    run(a.id, () => (isEntry(a.id)
      ? rejectTalentEntry(a.id)
      : isLpVirtual(a.id)
        ? bulkDeleteAccounts([{ id: a.id, email: a.email ?? null }]).then((r) => ({ ok: r.ok && (r.deleted ?? 0) > 0, error: r.ok ? r.errors?.[0]?.error : r.error }))
        : deleteAccount(a.id)), `${verb}しました`);
  };

  // ① スキルシートを開く（フリーランスのプロフィールから取得）。
  const openSheet = (a: Account) => {
    const eid = engineerIdOf(a.id);
    setSheetFor(a); setSheet(null); setSheetErr(null);
    if (!eid) { setSheetErr("この登録はまだプロフィール未生成のため、スキルシートを表示できません。"); return; }
    setSheetBusy(true);
    (async () => {
      try {
        const res = await prepareCandidateFromFreelancer(eid);
        if (res.ok && res.data) setSheet(res.data);
        else setSheetErr(res.error || "スキルシートを取得できませんでした。");
      } catch (e) { setSheetErr(e instanceof Error ? e.message : String(e)); }
      finally { setSheetBusy(false); }
    })();
  };
  const closeSheet = () => { setSheetFor(null); setSheet(null); setSheetErr(null); };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div className="muted" style={{ fontSize: 12 }}>
        {kind === "company"
          ? <>エンジャービジネス（enger.jp 法人登録）から届いた<b>企業の新規登録</b>です。承認すると自社ポータル（案件掲載・おすすめ人材・選考）を利用できるようになります。</>
          : <>エンジャーフリーランス（enger.jp）から届いた<b>人材の新規登録</b>です。<b>「面談」にチェック</b>すると、承認・人材マスタ登録（マッチング対象化）・全機能解放までまとめて行われます。「スキルシート」で登録内容を確認できます。</>}
      </div>
      {msg && (
        <div style={{ fontSize: 12.5, color: msg.ok ? "var(--color-success)" : "var(--color-danger)", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span>{msg.text}</span>
          {msg.ok && msg.candidateNo && (
            <Link href={`/matching?person=${msg.candidateNo}`} className="btn brand btn-xs" style={{ textDecoration: "none" }}>
              <span className="material-symbols-outlined" style={{ fontSize: 15, lineHeight: 1 }}>auto_awesome</span>
              この人材でマッチングを実行（P-{String(msg.candidateNo).padStart(5, "0")}）
            </Link>
          )}
        </div>
      )}
      {rows.length === 0 ? (
        <div className="card" style={{ textAlign: "center", color: "var(--color-ink-4)", padding: 30, fontSize: 13 }}>
          未対応の新着{noun}はありません。
        </div>
      ) : (
        <div className="card" style={{ padding: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {rows.map((a) => {
              const busy = busyId === a.id && pending;
              const sm = sourceMeta((a as any).signup_source);
              const canSheet = kind === "talent" && !!engineerIdOf(a.id);
              return (
                <div key={a.id}
                  style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "10px 12px", borderRadius: 10,
                    background: "var(--color-surface)", border: "1px solid var(--color-border)" }}>
                  <span aria-label="新着" style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".02em", padding: "2px 8px", borderRadius: 99, color: "#fff", background: "var(--color-danger, #dc2626)", flexShrink: 0 }}>New</span>
                  <span style={{ fontSize: 10.5, fontWeight: 800, padding: "2px 8px", borderRadius: 99, color: "#b45309", background: "#fff6e0", flexShrink: 0 }}>承認待ち</span>
                  <span title={`登録元：${sm.label}`} style={{ fontSize: 9.5, fontWeight: 800, padding: "2px 8px", borderRadius: 99, color: sm.color, background: sourceBgFor(sm.color), border: `1px solid ${sourceBgFor(sm.color)}`, flexShrink: 0 }}>{sm.short}</span>
                  <b style={{ fontSize: 12.5 }}>{a.name || "（名前未設定）"}</b>
                  <span className="muted mono" style={{ fontSize: 11 }}>{a.email}</span>
                  {a.company_name && <span className="muted" style={{ fontSize: 11 }}>{a.company_name}</span>}
                  {a.note && <span className="muted" style={{ fontSize: 10.5 }}>{a.note}</span>}
                  <span className="muted" style={{ fontSize: 10.5, marginLeft: "auto", flexShrink: 0 }} title={a.created_at}>{fmtDateTime(a.created_at)}</span>

                  {/* ① スキルシート（登録内容の確認） */}
                  {canSheet && (
                    <button type="button" className="btn ghost btn-xs" disabled={busy} onClick={() => openSheet(a)} title="登録されたスキルシート・プロフィールを表示"
                      style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 4 }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 15, verticalAlign: "-3px" }}>description</span>スキルシート
                    </button>
                  )}

                  {/* ②③ 面談チェック＝承認＋本登録＋全機能解放 */}
                  <label title={kind === "company" ? "面談チェックで承認します" : "面談チェックで承認・人材マスタ登録（マッチング対象化）・全機能解放を行います"}
                    style={{ display: "inline-flex", alignItems: "center", gap: 5, flexShrink: 0, fontSize: 12, fontWeight: 700, color: "#067647", cursor: busy ? "default" : "pointer" }}>
                    <input type="checkbox" disabled={busy} checked={false} onChange={() => { if (!busy) doMeeting(a); }}
                      style={{ width: 16, height: 16, accentColor: "#067647", cursor: busy ? "default" : "pointer" }} />
                    {busy ? "処理中…" : "面談"}
                  </label>

                  <button type="button" className="btn ghost btn-xs" disabled={busy} onClick={() => doDelete(a)} title={isEntry(a.id) ? "却下（取り込まない）" : "登録を削除（スパム等）"}
                    style={{ color: "var(--color-danger)", flexShrink: 0 }}>{isEntry(a.id) ? "却下" : "削除"}</button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ① スキルシート・モーダル */}
      {sheetFor && (
        <div onClick={closeSheet} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", zIndex: 400, display: "flex", justifyContent: "center", alignItems: "flex-start", padding: "6vh 16px", overflowY: "auto" }}>
          <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "min(680px, 96vw)", padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
              <div>
                <div className="muted" style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase" }}>Skill Sheet</div>
                <h3 style={{ margin: "2px 0 0", fontSize: 16, fontWeight: 800 }}>{sheetFor.name || sheetFor.email} のスキルシート</h3>
              </div>
              <button type="button" className="btn ghost btn-xs" onClick={closeSheet}>閉じる</button>
            </div>
            {sheetBusy && <div className="muted" style={{ fontSize: 13, padding: "12px 0" }}>読み込み中…</div>}
            {sheetErr && <div style={{ fontSize: 13, color: "var(--color-danger)" }}>{sheetErr}</div>}
            {sheet && (
              <div style={{ display: "flex", flexDirection: "column", gap: 12, fontSize: 13 }}>
                <div style={{ display: "grid", gridTemplateColumns: "110px 1fr", rowGap: 7, columnGap: 12 }}>
                  {sheet.already_no != null && <><div className="muted">登録済み</div><div style={{ fontWeight: 700 }}>P-{String(sheet.already_no).padStart(5, "0")}（既に人材マスタにあります）</div></>}
                  {sheet.title && <><div className="muted">職種</div><div>{sheet.title}</div></>}
                  {sheet.rate && <><div className="muted">希望単価</div><div>{sheet.rate}</div></>}
                  {(sheet.location || sheet.residence) && <><div className="muted">最寄り駅 / 居住地</div><div>{[sheet.location, sheet.residence].filter(Boolean).join(" / ") || "—"}</div></>}
                  {sheet.remote_pref && <><div className="muted">リモート希望</div><div>{sheet.remote_pref}</div></>}
                  {sheet.age_band && <><div className="muted">年代</div><div>{sheet.age_band}</div></>}
                  {sheet.nationality && <><div className="muted">国籍</div><div>{sheet.nationality}</div></>}
                  {sheet.industries && <><div className="muted">経験業種</div><div>{sheet.industries}</div></>}
                  {sheet.email && <><div className="muted">連絡先</div><div className="mono" style={{ fontSize: 12 }}>{sheet.email}</div></>}
                </div>
                {sheet.skills.length > 0 && (
                  <div>
                    <div className="muted" style={{ fontSize: 11, fontWeight: 700, marginBottom: 5 }}>スキル（{sheet.skills.length}）</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                      {sheet.skills.map((s) => <span key={s} className="tag brand" style={{ fontSize: 11 }}>{s}</span>)}
                    </div>
                  </div>
                )}
                {sheet.tools.length > 0 && (
                  <div>
                    <div className="muted" style={{ fontSize: 11, fontWeight: 700, marginBottom: 5 }}>ツール・開発環境</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                      {sheet.tools.map((s) => <span key={s} className="tag" style={{ fontSize: 11 }}>{s}</span>)}
                    </div>
                  </div>
                )}
                {sheet.pr_text && (
                  <div>
                    <div className="muted" style={{ fontSize: 11, fontWeight: 700, marginBottom: 4 }}>自己PR</div>
                    <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.8, background: "var(--color-surface-inset)", borderRadius: 8, padding: 10 }}>{sheet.pr_text}</div>
                  </div>
                )}
                <div>
                  <div className="muted" style={{ fontSize: 11, fontWeight: 700, marginBottom: 5 }}>アップロードされたスキルシート（{sheet.skill_sheets.length}）</div>
                  {sheet.skill_sheets.length === 0 ? (
                    <div className="muted" style={{ fontSize: 12 }}>ファイルのアップロードはありません（プロフィール入力から作成された内容です）。</div>
                  ) : (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {sheet.skill_sheets.map((f, i) => (
                        <a key={i} href={f.url} target="_blank" rel="noopener noreferrer" className="btn ghost btn-xs" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}>
                          <span className="material-symbols-outlined" style={{ fontSize: 15, verticalAlign: "-3px" }}>open_in_new</span>{f.name || `スキルシート${i + 1}`}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, borderTop: "1px solid var(--color-border)", paddingTop: 12 }}>
                  <button type="button" className="btn brand btn-xs" disabled={busyId === sheetFor.id && pending} onClick={() => { const a = sheetFor; closeSheet(); doMeeting(a); }}
                    title="このまま面談済で本登録（マッチング対象化・全機能解放）します">
                    面談済で本登録する
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
