"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Engineer, EngineerAction, Scout, Application } from "@/lib/engineers";
import { addEngineerAction, deleteEngineerAction, sendScout, updateApplicationStage } from "@/app/engineers/actions";
import { APPLICATION_STAGES } from "@/lib/engineers";

const pay = (e: Engineer) => {
  const lo = e.estimated_pay_low, hi = e.estimated_pay_high, mid = e.estimated_pay_mid;
  if (lo && hi) return `¥${lo}〜${hi}万`;
  if (mid) return `¥${mid}万`;
  return "—";
};
const skillNames = (e: Engineer) => (e.skills ?? []).map((s) => s.name).filter(Boolean);

// タップ選択中心の対応種別（営業の入力を最小化）
const ACTION_TYPES = ["スカウト送信", "メール送信", "返信あり", "面談設定", "面談実施", "見送り", "保留", "メモ"];
const ACTION_COLOR: Record<string, string> = {
  "スカウト送信": "#0b5cab", "メール送信": "#0b5cab", "返信あり": "#067647", "面談設定": "#067647",
  "面談実施": "#067647", "見送り": "#b42318", "保留": "#b45309", "メモ": "#475467",
};
const fmtDate = (s: string) => { const d = new Date(s); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

const SCOUT_STATUS: Record<string, { label: string; color: string }> = {
  sent: { label: "送信済み", color: "#0b5cab" },
  read: { label: "既読", color: "#475467" },
  interested: { label: "興味あり", color: "#067647" },
  declined: { label: "見送り", color: "#b42318" },
};

export function EngineersClient({ engineers, actions = {}, scouts = {}, applications = {} }: { engineers: Engineer[]; actions?: Record<string, EngineerAction[]>; scouts?: Record<string, Scout[]>; applications?: Record<string, Application[]> }) {
  const [q, setQ] = useState("");
  const [detail, setDetail] = useState<Engineer | null>(null);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return engineers;
    return engineers.filter((e) => [e.display_name, e.github_login, e.primary_language, ...skillNames(e)].filter(Boolean).join(" ").toLowerCase().includes(t));
  }, [q, engineers]);

  if (engineers.length === 0) {
    return <div className="card" style={{ textAlign: "center", color: "var(--color-ink-4)", padding: 40, fontSize: 13 }}>まだ enger.jp 経由で登録したエンジニアがいません。</div>;
  }

  return (
    <>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <div className="tbl-search" style={{ width: 260, flex: "0 0 260px" }}><input placeholder="氏名・スキル・言語で検索…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <span className="muted" style={{ fontSize: 11.5 }}>{filtered.length} 名</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
        {filtered.map((e) => {
          const log = actions[e.id] ?? [];
          const sc = scouts[e.id] ?? [];
          const ap = applications[e.id] ?? [];
          return (
          <button key={e.id} onClick={() => setDetail(e)} className="card" style={{ textAlign: "left", cursor: "pointer", padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {e.avatar_url ? <img src={e.avatar_url} alt="" style={{ width: 42, height: 42, borderRadius: 99, flex: "0 0 42px" }} /> : <div className="ava" style={{ width: 42, height: 42, flex: "0 0 42px" }}>{(e.display_name ?? e.github_login ?? "?").slice(0, 2)}</div>}
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.display_name || e.github_login || "—"}</div>
                <div className="muted" style={{ fontSize: 11 }}>{e.github_login ? `@${e.github_login}` : ""} · {e.primary_language ?? "—"}</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              {skillNames(e).slice(0, 6).map((s) => <span key={s} className="tag" style={{ fontSize: 10.5, background: "var(--color-brand-25)", color: "var(--color-brand-700,#0b5cab)" }}>{s}</span>)}
            </div>
            <div style={{ display: "flex", gap: 14, fontSize: 11.5, color: "var(--color-ink-3)", borderTop: "1px solid var(--color-border)", paddingTop: 8, alignItems: "center" }}>
              <span>想定単価 <b style={{ color: "var(--color-ink)" }}>{pay(e)}</b></span>
              <span>★{e.total_stars}</span>
              <span>repo {e.total_repos}</span>
              <span style={{ marginLeft: "auto", display: "inline-flex", gap: 5 }}>
                {ap.length > 0 && (
                  <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 99, background: "#e7f7ee", color: "#067647" }}>応募 {ap.length}</span>
                )}
                {sc.length > 0 && (
                  <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 99, background: "#e7f0fb", color: "#0b5cab" }}>スカウト {sc.length}</span>
                )}
                {log.length > 0 && (
                  <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 99, background: "#eef2ff", color: "#3730a3" }}>対応 {log.length}</span>
                )}
              </span>
            </div>
          </button>
        );})}
      </div>

      {detail && (
        <DetailModal engineer={detail} log={actions[detail.id] ?? []} scoutLog={scouts[detail.id] ?? []} appLog={applications[detail.id] ?? []} onClose={() => setDetail(null)} />
      )}
    </>
  );
}

function DetailModal({ engineer: detail, log, scoutLog, appLog, onClose }: { engineer: Engineer; log: EngineerAction[]; scoutLog: Scout[]; appLog: Application[]; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [action, setAction] = useState<string>("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [scoutMsg, setScoutMsg] = useState("");
  const [scoutJob, setScoutJob] = useState("");
  const [scoutErr, setScoutErr] = useState<string | null>(null);

  const submitScout = () => {
    if (!scoutMsg.trim()) { setScoutErr("スカウト本文を入力してください"); return; }
    setScoutErr(null);
    start(async () => {
      const res = await sendScout({ engineer_id: detail.id, engineer_name: detail.display_name || detail.github_login, job_title: scoutJob, message: scoutMsg });
      if (!res.ok) { setScoutErr(res.error || "送信に失敗しました"); return; }
      setScoutMsg(""); setScoutJob("");
      router.refresh();
    });
  };

  const submit = () => {
    if (!action) { setErr("対応の種類を選んでください"); return; }
    setErr(null);
    start(async () => {
      const res = await addEngineerAction({ engineer_id: detail.id, engineer_name: detail.display_name || detail.github_login, action, note });
      if (!res.ok) { setErr(res.error || "保存に失敗しました"); return; }
      setAction(""); setNote("");
      router.refresh();
    });
  };
  const remove = (id: string) => {
    start(async () => { await deleteEngineerAction(id); router.refresh(); });
  };
  const changeStage = (id: string, stage: string) => {
    start(async () => { await updateApplicationStage(id, stage); router.refresh(); });
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", display: "grid", placeItems: "center", zIndex: 300, padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "100%", maxWidth: 560, maxHeight: "88vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {detail.avatar_url ? <img src={detail.avatar_url} alt="" style={{ width: 48, height: 48, borderRadius: 99 }} /> : <div className="ava" style={{ width: 48, height: 48 }}>{(detail.display_name ?? "?").slice(0, 2)}</div>}
            <div>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>{detail.display_name || detail.github_login}</h3>
              <div className="muted" style={{ fontSize: 12 }}>{detail.github_login ? <a href={`https://github.com/${detail.github_login}`} target="_blank" rel="noreferrer" style={{ color: "var(--color-brand-700,#0b5cab)" }}>@{detail.github_login}</a> : ""} · {detail.primary_language ?? "—"}</div>
            </div>
          </div>
          <button className="btn ghost btn-xs" onClick={onClose}>閉じる</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 1, background: "var(--color-border)", border: "1px solid var(--color-border)", borderRadius: 10, overflow: "hidden" }}>
          {[["想定単価", pay(detail)], ["★ Stars", detail.total_stars], ["リポジトリ", detail.total_repos]].map(([l, v], i) => (
            <div key={i} style={{ background: "var(--color-surface)", padding: "9px 11px" }}><div style={{ fontSize: 10, color: "var(--color-ink-4)", fontWeight: 600 }}>{l}</div><div style={{ fontSize: 14, fontWeight: 700, marginTop: 2 }}>{String(v)}</div></div>
          ))}
        </div>
        <div>
          <div style={{ fontSize: 11, color: "var(--color-ink-4)", fontWeight: 600, marginBottom: 5 }}>スキル（GitHub解析）</div>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
            {skillNames(detail).length === 0 ? <span className="muted" style={{ fontSize: 12 }}>—</span> : (detail.skills ?? []).slice(0, 20).map((s) => (
              <span key={s.name} className="tag" style={{ fontSize: 11 }}>{s.name}{s.level ? ` (${s.level})` : ""}</span>
            ))}
          </div>
        </div>
        {detail.email && <div style={{ fontSize: 12, color: "var(--color-ink-3)" }}>連絡先：<a href={`mailto:${detail.email}`} style={{ color: "var(--color-brand-700,#0b5cab)" }}>{detail.email}</a></div>}

        {(detail.portfolio_url || detail.skill_sheet_url) && (
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12 }}>
            {detail.portfolio_url && (
              <a href={detail.portfolio_url} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--color-brand-700,#0b5cab)", fontWeight: 600 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>link</span>ポートフォリオ
              </a>
            )}
            {detail.skill_sheet_url && (
              <a href={detail.skill_sheet_url} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--color-brand-700,#0b5cab)", fontWeight: 600 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>description</span>スキルシート{detail.skill_sheet_name ? `（${detail.skill_sheet_name}）` : ""}
              </a>
            )}
          </div>
        )}

        {/* 応募（エンジニアからの応募） */}
        {appLog.length > 0 && (
          <div style={{ borderTop: "1px solid var(--color-border)", paddingTop: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>応募した案件 <span className="muted" style={{ fontWeight: 400 }}>（{appLog.length}件）</span></div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {appLog.map((a) => {
                const stg = a.stage || "応募";
                const tone = stg === "稼働" ? "#067647" : stg === "面談合格" ? "#0b5cab" : stg === "見送り" ? "#b42318" : "#475467";
                return (
                  <div key={a.id} style={{ fontSize: 12, padding: "8px 10px", border: "1px solid var(--color-border)", borderRadius: 8, background: "var(--color-surface)", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ width: 8, height: 8, borderRadius: 99, background: tone, flex: "0 0 auto" }} />
                    <span style={{ color: "var(--color-ink-2)", minWidth: 0, flex: 1 }}>{a.job_title || a.job_no || "案件"}</span>
                    <select value={stg} disabled={pending} onChange={(e) => changeStage(a.id, e.target.value)} style={{ fontSize: 11, padding: "3px 6px", borderRadius: 6, border: "1px solid var(--color-border)", background: "var(--color-surface)", color: tone, fontWeight: 700 }}>
                      {APPLICATION_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <span className="muted" style={{ fontSize: 10.5, width: "100%", textAlign: "right" }}>{fmtDate(a.created_at)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* スカウト */}
        <div style={{ borderTop: "1px solid var(--color-border)", paddingTop: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>スカウト <span className="muted" style={{ fontWeight: 400 }}>（{scoutLog.length}件）</span></div>

          <div style={{ background: "var(--color-bg, #f7f8fa)", border: "1px solid var(--color-border)", borderRadius: 10, padding: 10, display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
            <input value={scoutJob} onChange={(e) => setScoutJob(e.target.value)} placeholder="対象案件名（任意）" style={{ fontSize: 12, padding: "7px 10px", borderRadius: 8, border: "1px solid var(--color-border)", background: "var(--color-surface)" }} />
            <textarea value={scoutMsg} onChange={(e) => setScoutMsg(e.target.value)} rows={3} placeholder="スカウト本文：案件の魅力・なぜあなたか・次のステップを簡潔に" style={{ fontSize: 12, padding: "7px 10px", borderRadius: 8, border: "1px solid var(--color-border)", background: "var(--color-surface)", resize: "vertical" }} />
            {scoutErr && <div style={{ fontSize: 11.5, color: "#b42318" }}>{scoutErr}</div>}
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button type="button" className="btn btn-xs" disabled={pending} onClick={submitScout} style={{ opacity: pending ? 0.6 : 1 }}>{pending ? "送信中…" : "スカウトを送る"}</button>
            </div>
          </div>

          {scoutLog.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {scoutLog.map((s) => {
                const st = SCOUT_STATUS[s.status] ?? SCOUT_STATUS.sent;
                return (
                  <div key={s.id} style={{ fontSize: 12, padding: "8px 10px", border: "1px solid var(--color-border)", borderRadius: 8, background: "var(--color-surface)" }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 7px", borderRadius: 99, color: "#fff", background: st.color }}>{st.label}</span>
                      {s.job_title && <span className="muted" style={{ fontSize: 11 }}>{s.job_title}</span>}
                      <span className="muted" style={{ fontSize: 10.5, marginLeft: "auto" }}>{fmtDate(s.created_at)}{s.agent ? ` · ${s.agent}` : ""}</span>
                    </div>
                    <div style={{ color: "var(--color-ink-2)", marginTop: 4, whiteSpace: "pre-wrap" }}>{s.message}</div>
                    {s.reply && <div style={{ marginTop: 6, padding: "6px 8px", borderRadius: 6, background: "var(--color-bg,#f7f8fa)", fontSize: 11.5 }}><b>返信：</b>{s.reply}</div>}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 対応履歴 */}
        <div style={{ borderTop: "1px solid var(--color-border)", paddingTop: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>対応履歴 <span className="muted" style={{ fontWeight: 400 }}>（{log.length}件）</span></div>

          {/* 記録フォーム：タップ選択中心 */}
          <div style={{ background: "var(--color-bg, #f7f8fa)", border: "1px solid var(--color-border)", borderRadius: 10, padding: 10, display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {ACTION_TYPES.map((a) => (
                <button key={a} type="button" onClick={() => setAction(a)}
                  className="tag" style={{ cursor: "pointer", fontSize: 11, fontWeight: 600, border: action === a ? "1.5px solid " + (ACTION_COLOR[a] || "#0b5cab") : "1px solid var(--color-border)", background: action === a ? (ACTION_COLOR[a] || "#0b5cab") : "var(--color-surface)", color: action === a ? "#fff" : "var(--color-ink-2)" }}>{a}</button>
              ))}
            </div>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="メモ（任意）：温度感・次の一手など" style={{ fontSize: 12, padding: "7px 10px", borderRadius: 8, border: "1px solid var(--color-border)", background: "var(--color-surface)" }} />
            {err && <div style={{ fontSize: 11.5, color: "#b42318" }}>{err}</div>}
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button type="button" className="btn btn-xs" disabled={pending} onClick={submit} style={{ opacity: pending ? 0.6 : 1 }}>{pending ? "記録中…" : "対応を記録"}</button>
            </div>
          </div>

          {/* 履歴リスト */}
          {log.length === 0 ? (
            <div className="muted" style={{ fontSize: 12 }}>まだ対応履歴はありません。上から記録できます。</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {log.map((a) => (
                <div key={a.id} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12, padding: "7px 9px", border: "1px solid var(--color-border)", borderRadius: 8, background: "var(--color-surface)" }}>
                  <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 7px", borderRadius: 99, flex: "0 0 auto", color: "#fff", background: ACTION_COLOR[a.action] || "#475467" }}>{a.action}</span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    {a.note && <div style={{ color: "var(--color-ink-2)" }}>{a.note}</div>}
                    <div className="muted" style={{ fontSize: 10.5, marginTop: 2 }}>{fmtDate(a.created_at)}{a.operator ? ` · ${a.operator}` : ""}</div>
                  </div>
                  <button type="button" onClick={() => remove(a.id)} disabled={pending} title="削除" className="btn ghost btn-xs" style={{ flex: "0 0 auto", padding: "2px 7px", color: "#b42318" }}>×</button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="muted" style={{ fontSize: 10.5 }}>※ enger.jp（GitHub連携）で本人が登録したプロフィールです。対応履歴は重複アプローチ防止・引き継ぎのために共有されます。</div>
      </div>
    </div>
  );
}
