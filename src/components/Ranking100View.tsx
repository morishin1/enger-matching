"use client";

// ランキング100／おすすめTOP50：定義書の除外条件を満たす案件×人材ペアを一致スキル数順に表示。
//   行クリックで「案件×人材を横並びで比較」できるドロワーを開く。
//   ・左：案件詳細／右：人材詳細／上部：一致スキル・案件のみ・人材のみのスキル比較。
//   ・ドロワーから「→ 提案画面」「案件ページへ」「人材ページへ」も開ける。
//   ・行のチェックボックスでペアを選択すると、下部フローティングバー（件数＋提案する/AI/コピーする/予約配信）
//     から一括操作できる（おすすめTOP50・ランキング100 共通）。
//   ・予約配信：カレンダーで日時を指定すると、その時刻に選択ペアを自動で提案登録＋メール配信する
//     （実行は /api/cron/proposal-schedules・15分間隔バッチ）。

import Link from "@/components/AppLink";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { RankedPair } from "@/lib/ranking100";
import { recordProposal } from "@/lib/actions";
import { buildProposalPrompt } from "@/lib/gmail";
import { toast } from "@/components/toast";
import { scheduleProposalDelivery, listProposalSchedules, cancelProposalSchedule, type ScheduleRow } from "@/lib/proposal-schedule";

const salaryLabel = (lo?: number | null, hi?: number | null) =>
  lo && hi ? (lo === hi ? `¥${lo}万` : `¥${lo}〜${hi}万`) : hi ? `〜¥${hi}万` : lo ? `¥${lo}万〜` : "—";
const remoteLabel = (r?: string | null) =>
  r === "full_remote" ? "フルリモート" : r === "partial_remote" ? "一部リモート" : r === "onsite" ? "出社" : (r || "—");

function RankBadge({ n }: { n: number }) {
  const color = n === 1 ? "#f0a92b" : n === 2 ? "#9aa7b4" : n === 3 ? "#cd853f" : "var(--color-surface-inset)";
  const fg = n <= 3 ? "#fff" : "var(--color-ink-3)";
  return (
    <span style={{ display: "inline-grid", placeItems: "center", width: 28, height: 28, borderRadius: 99, background: color, color: fg, fontSize: 12, fontWeight: 800, fontFamily: "var(--font-display)" }}>{n}</span>
  );
}

const pairKey = (r: RankedPair) => `${r.job.job_no}-${r.cand.candidate_no}`;

// 選択ペアの共有用テキスト（「コピーする」・AIモーダルの見出しで使用）。
function pairSummaryText(list: RankedPair[]): string {
  const lines: string[] = [`【提案候補 ${list.length}件】マッチングおすすめ組み合わせ`];
  list.forEach((r, i) => {
    lines.push(
      `${i + 1}. 案件 No.${String(r.job.job_no).padStart(5, "0")}「${r.job.title}」${[r.job.client_name, salaryLabel(r.job.salary_min, r.job.salary_max)].filter(Boolean).join(" / ")}`,
      `   人材 P-${String(r.cand.candidate_no).padStart(5, "0")} ${r.cand.name}${[r.cand.title, r.cand.rate].filter(Boolean).map((s) => ` / ${s}`).join("")}`,
      `   マッチ度 ${r.score}%・一致スキル: ${r.matchedSkills.join(", ") || "—"}`,
    );
  });
  return lines.join("\n");
}

// クリップボードコピー（clipboard API → execCommand フォールバック。CopyButton と同方式）。
async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else if (typeof document !== "undefined") {
      const ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      document.execCommand("copy"); document.body.removeChild(ta);
    } else return false;
    return true;
  } catch { return false; }
}

// datetime-local 入力用のローカル時刻文字列（YYYY-MM-DDTHH:mm）。
const toLocalInputValue = (d: Date) => {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const SCHEDULE_STATUS_LABEL: Record<string, string> = {
  pending: "予約中", processing: "配信中", done: "配信済み", canceled: "キャンセル", error: "エラー",
};

export function Ranking100View({ rows, meta, title, subtitle }: { rows: RankedPair[]; meta: { jobsScanned: number; candsScanned: number; pairsHit: number }; title?: string; subtitle?: React.ReactNode }) {
  const router = useRouter();
  const [active, setActive] = useState<RankedPair | null>(null);
  const [drawerIn, setDrawerIn] = useState(false);
  // チェック選択 → 一括操作（提案する / AI / コピーする）。
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<null | { kind: "propose" | "ai"; done: number; total: number }>(null);
  const cancelRef = useRef(false);
  const [aiResults, setAiResults] = useState<null | { heading: string; text: string }[]>(null);
  // 予約配信モーダル：日時（datetime-local）＋既存予約の一覧。
  const [schedOpen, setSchedOpen] = useState(false);
  const [schedAt, setSchedAt] = useState("");
  const [schedBusy, setSchedBusy] = useState(false);
  const [schedList, setSchedList] = useState<ScheduleRow[] | null>(null);
  useEffect(() => {
    if (!active) { setDrawerIn(false); return; }
    const id = requestAnimationFrame(() => setDrawerIn(true));
    return () => cancelAnimationFrame(id);
  }, [active]);
  const closeDrawer = () => { setDrawerIn(false); setTimeout(() => setActive(null), 260); };
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeDrawer(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [active]);

  const selectedRows = rows.filter((r) => selected.has(pairKey(r)));
  const allChecked = rows.length > 0 && selectedRows.length === rows.length;
  const toggleOne = (r: RankedPair) => setSelected((prev) => {
    const next = new Set(prev); const k = pairKey(r);
    next.has(k) ? next.delete(k) : next.add(k);
    return next;
  });
  const toggleAll = () => setSelected(allChecked ? new Set() : new Set(rows.map(pairKey)));

  // 一括「提案する」：recordProposal（冪等・メールなし・ボードに記録）を選択ペアへ順次実行。
  const doProposeAll = async () => {
    if (selectedRows.length === 0 || busy) return;
    cancelRef.current = false;
    setBusy({ kind: "propose", done: 0, total: selectedRows.length });
    let created = 0, existed = 0, failed = 0; let firstError: string | null = null;
    for (let i = 0; i < selectedRows.length; i++) {
      if (cancelRef.current) break;
      const r = selectedRows[i];
      try {
        const res: any = await recordProposal(r.job.job_no, r.cand.candidate_no, r.score);
        if (res?.ok) { res.existed ? existed++ : created++; }
        else { failed++; if (!firstError) firstError = res?.error ?? null; }
      } catch (e) { failed++; if (!firstError) firstError = e instanceof Error ? e.message : String(e); }
      setBusy({ kind: "propose", done: i + 1, total: selectedRows.length });
    }
    setBusy(null);
    const parts = [`提案を記録：新規 ${created}件`];
    if (existed) parts.push(`既存 ${existed}件`);
    if (failed) parts.push(`失敗 ${failed}件`);
    toast(parts.join(" / ") + (firstError ? `（${firstError}）` : ""), failed ? "error" : "success");
    if (created > 0) { setSelected(new Set()); router.refresh(); }
  };

  // 一括「AI」：選択ペアぶんの提案文（クライアント向け）を /api/proposal で順次生成し、モーダルに表示。
  const doAiAll = async () => {
    if (selectedRows.length === 0 || busy) return;
    cancelRef.current = false;
    setBusy({ kind: "ai", done: 0, total: selectedRows.length });
    const out: { heading: string; text: string }[] = [];
    for (let i = 0; i < selectedRows.length; i++) {
      if (cancelRef.current) break;
      const r = selectedRows[i];
      const heading = `No.${String(r.job.job_no).padStart(5, "0")}「${r.job.title}」 × P-${String(r.cand.candidate_no).padStart(5, "0")} ${r.cand.name}（マッチ度 ${r.score}%）`;
      try {
        const prompt = buildProposalPrompt({ target: "client", job: r.job, cand: r.cand, matchedSkills: r.matchedSkills, missingSkills: r.missingSkills, score: r.score });
        const res = await fetch("/api/proposal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt }) });
        const data = await res.json();
        out.push({ heading, text: data?.ok ? String(data.text ?? "") : `（生成に失敗：${data?.error ?? "不明なエラー"}）` });
      } catch (e) {
        out.push({ heading, text: `（生成に失敗：${e instanceof Error ? e.message : String(e)}）` });
      }
      setBusy({ kind: "ai", done: i + 1, total: selectedRows.length });
    }
    setBusy(null);
    if (out.length > 0) setAiResults(out);
  };

  // 一括「コピーする」：選択ペアの一覧テキストをクリップボードへ。
  const doCopyAll = async () => {
    if (selectedRows.length === 0) return;
    const ok = await copyText(pairSummaryText(selectedRows));
    toast(ok ? `選択中の ${selectedRows.length} 件をコピーしました` : "コピーに失敗しました", ok ? "success" : "error");
  };

  // 「予約配信」モーダルを開く（既定日時＝1時間後を10分単位に切り上げ）。
  const refreshSchedules = async () => {
    try { const r = await listProposalSchedules(); setSchedList(r.rows ?? []); }
    catch { setSchedList([]); /* 一覧失敗でも予約自体は可能 */ }
  };
  const openSchedule = () => {
    if (selectedRows.length === 0) return;
    const d = new Date(Date.now() + 60 * 60 * 1000);
    d.setMinutes(Math.ceil(d.getMinutes() / 10) * 10, 0, 0);
    setSchedAt(toLocalInputValue(d));
    setSchedOpen(true);
    setSchedList(null);
    void refreshSchedules();
  };

  // 予約を確定：選択ペア＋日時をサーバに保存（配信は cron が実行）。
  const doSchedule = async () => {
    if (selectedRows.length === 0 || schedBusy) return;
    const at = new Date(schedAt);
    if (!schedAt || isNaN(at.getTime())) { toast("配信日時を選択してください", "error"); return; }
    if (at.getTime() < Date.now()) { toast("過去の日時は指定できません", "error"); return; }
    setSchedBusy(true);
    try {
      const res = await scheduleProposalDelivery({
        pairs: selectedRows.map((r) => ({ job_no: r.job.job_no, candidate_no: r.cand.candidate_no, score: r.score })),
        scheduledAt: at.toISOString(),
      });
      if (res.ok) {
        toast(`${selectedRows.length} 件を ${at.toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} に配信予約しました`, "success");
        setSelected(new Set());
        setSchedOpen(false);
      } else {
        toast(res.error ?? "予約に失敗しました", "error");
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally { setSchedBusy(false); }
  };

  const doCancelSchedule = async (id: string) => {
    try {
      const res = await cancelProposalSchedule(id);
      toast(res.ok ? "予約をキャンセルしました" : (res.error ?? "キャンセルに失敗しました"), res.ok ? "success" : "error");
      if (res.ok) void refreshSchedules();
    } catch (e) { toast(e instanceof Error ? e.message : String(e), "error"); }
  };

  return (
    <div className="card flush">
      <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--color-border)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 800 }}>{title ?? "🏆 ランキング100"} <span className="tag brand">{rows.length}件</span></div>
          <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
            {subtitle ?? <>定義書の除外条件（フルリモート案件・所属/商流・日本国籍・年齢・単価差7万円以上・スキルシート有）を満たすペアを、<b>一致スキル数の多い順</b>で表示（同数は単価差 → 注力案件 → 総合スコア）。
            対象：案件 {meta.jobsScanned.toLocaleString("ja-JP")} 件 × 人材 {meta.candsScanned.toLocaleString("ja-JP")} 名（適合 {meta.pairsHit.toLocaleString("ja-JP")} ペア）・5分毎に更新。</>}
          </div>
          <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
            行をクリックすると<b>案件×人材を横並びで比較</b>できます。
            総合の下の<b>内訳バー</b>（ス=必須スキル / 単=単価 / 時=稼働時期 / 年=年代 / 勤=勤務形態）でどの次元が満点かを確認できます（<span style={{ color: "#9aa7b4" }}>グレー=情報不明</span>）。
            ボーナスがあるペアは<b style={{ color: "#0095D9" }}>+N</b>を表示します（マージン理想・尚可スキル一致・業界経験 等）。
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--color-ink-4)", fontSize: 13 }}>
          抽出条件（フルリモート案件・所属/商流・日本国籍・年齢・単価差7万円以上・スキルシート有・スキル一致）を満たすペアが見つかりませんでした。
          案件・人材のスキル/所属/単価/スキルシートの登録を充実させると候補が増えます。
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12.5, minWidth: 980 }}>
            <thead>
              <tr style={{ color: "var(--color-ink-4)", fontSize: 11, background: "var(--color-surface-soft)" }}>
                <th style={{ padding: "8px 10px", width: 36 }}>
                  <input type="checkbox" checked={allChecked} onChange={toggleAll} aria-label="すべて選択"
                    style={{ accentColor: "var(--color-brand-600)", cursor: "pointer" }} />
                </th>
                <th style={{ padding: "8px 10px", width: 48 }}>順位</th>
                <th style={{ padding: "8px 10px", textAlign: "right", width: 84 }}>総合</th>
                <th style={{ padding: "8px 10px", textAlign: "left", width: 110 }}>必須スキル</th>
                <th style={{ padding: "8px 10px", textAlign: "left" }}>案件</th>
                <th style={{ padding: "8px 10px", textAlign: "left" }}>人材</th>
                <th style={{ padding: "8px 10px", textAlign: "left" }}>一致スキル</th>
                <th style={{ padding: "8px 10px", textAlign: "right", width: 120 }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.job.job_no}-${r.cand.candidate_no}`}
                  onClick={(e) => { if ((e.target as HTMLElement).closest("a,button,input,select,textarea,label")) return; setActive(r); }}
                  title="クリックで案件×人材の詳細を比較"
                  style={{ cursor: "pointer", opacity: r.proposed ? 0.62 : 1, background: selected.has(pairKey(r)) ? "var(--color-brand-25)" : r.proposed ? "var(--color-surface-inset)" : undefined }}>
                  <td style={{ padding: "8px 10px", borderTop: "1px solid var(--color-border)", textAlign: "center" }}>
                    <input type="checkbox" checked={selected.has(pairKey(r))} onChange={() => toggleOne(r)}
                      aria-label="このペアを選択" style={{ accentColor: "var(--color-brand-600)", cursor: "pointer" }} />
                  </td>
                  <td style={{ padding: "8px 10px", borderTop: "1px solid var(--color-border)", textAlign: "center" }}><RankBadge n={r.rank} /></td>
                  <td style={{ padding: "8px 10px", borderTop: "1px solid var(--color-border)", textAlign: "right" }}>
                    {/* 内訳（5次元ミニバー＋ボーナス）は撤去し、総合スコアのみのシンプル表示（要望対応）。 */}
                    <span className="display tnum" style={{ fontSize: 17, fontWeight: 800, color: r.score >= 80 ? "#067647" : r.score >= 60 ? "#0b5cab" : "#9a5b1a" }}>{r.score}</span><span className="muted" style={{ fontSize: 10 }}>%</span>
                  </td>
                  <td style={{ padding: "8px 10px", borderTop: "1px solid var(--color-border)" }}>
                    <div className="tnum" style={{ fontSize: 13, fontWeight: 800, color: r.skillPct >= 100 ? "#067647" : "#0b5cab" }}>{r.matchedCount}/{r.jobSkillCount}</div>
                    <div className="muted" style={{ fontSize: 10.5 }}>{r.skillPct}% 一致</div>
                  </td>
                  <td style={{ padding: "8px 10px", borderTop: "1px solid var(--color-border)" }}>
                    <div style={{ fontWeight: 700, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <Link href={`/jobs/${r.job.job_no}`} style={{ color: "var(--color-brand-700)", textDecoration: "none" }}>{r.job.title}</Link>
                      <span className="mono muted" style={{ fontSize: 10, fontWeight: 400 }}>No.{String(r.job.job_no).padStart(5, "0")}</span>
                    </div>
                    <div className="muted" style={{ fontSize: 11 }}>{[r.job.client_name, salaryLabel(r.job.salary_min, r.job.salary_max)].filter(Boolean).join(" · ")}</div>
                  </td>
                  <td style={{ padding: "8px 10px", borderTop: "1px solid var(--color-border)" }}>
                    <div style={{ fontWeight: 700, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <Link href={`/people/${r.cand.candidate_no}`} style={{ color: "var(--color-brand-700)", textDecoration: "none" }}>{r.cand.name}</Link>
                      <span className="mono muted" style={{ fontSize: 10, fontWeight: 400 }}>P-{String(r.cand.candidate_no).padStart(5, "0")}</span>
                      {r.proposed && <span style={{ fontSize: 9.5, fontWeight: 700, padding: "1px 6px", borderRadius: 99, background: "#e8ebef", color: "#5b6675", border: "1px solid #d3d9e0" }}>✓ 提案済み</span>}
                    </div>
                    <div className="muted" style={{ fontSize: 11 }}>{[r.cand.title, r.cand.company, r.cand.rate].filter(Boolean).join(" · ")}</div>
                  </td>
                  <td style={{ padding: "8px 10px", borderTop: "1px solid var(--color-border)" }}>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {r.matchedSkills.slice(0, 6).map((s) => <span key={s} className="tag brand" style={{ fontSize: 10 }}>{s}</span>)}
                      {r.matchedSkills.length > 6 && <span className="muted" style={{ fontSize: 10.5, fontWeight: 600 }}>+{r.matchedSkills.length - 6}</span>}
                    </div>
                  </td>
                  <td style={{ padding: "8px 10px", borderTop: "1px solid var(--color-border)", textAlign: "right", whiteSpace: "nowrap" }}>
                    <Link href={`/matching?job=${r.job.job_no}&cand=${r.cand.candidate_no}`} className="btn brand btn-xs" style={{ textDecoration: "none" }}
                      title="このペアでマッチング画面（提案）を開く">→ 提案画面</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {active && <ComparisonDrawer p={active} drawerIn={drawerIn} onClose={closeDrawer} />}

      {/* 選択中の一括操作バー（画面下部フローティング固定）：件数＋提案する / AI / コピーする。 */}
      {selected.size > 0 && (
        <div className="bulk-bar">
          <span style={{ whiteSpace: "nowrap" }}><b>{selected.size}</b> 件選択中</span>
          {busy && (
            <span style={{ fontSize: 12, opacity: 0.85, whiteSpace: "nowrap" }}>
              {busy.kind === "propose" ? "提案を記録中" : "AIで文面を生成中"}… {busy.done}/{busy.total}
            </span>
          )}
          <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
            {busy ? (
              <button type="button" className="btn ghost" onClick={() => { cancelRef.current = true; }}>中止</button>
            ) : (
              <>
                <button type="button" className="btn brand" onClick={doProposeAll}
                  title="選択したペアを提案ボードに一括記録します（メールは送りません。提案済みのペアはスキップ扱い）">
                  <span className="material-symbols-outlined" style={{ fontSize: 16, verticalAlign: "-3px" }}>send</span> 提案する
                </button>
                <button type="button" className="btn" onClick={doAiAll}
                  style={{ background: "#7c5cff", borderColor: "#7c5cff", color: "#fff" }}
                  title="選択したペアぶんの提案文（クライアント向け）をAIで生成してまとめて表示します">
                  <span className="material-symbols-outlined" style={{ fontSize: 16, verticalAlign: "-3px" }}>auto_awesome</span> AI
                </button>
                <button type="button" className="btn ghost" onClick={doCopyAll}
                  title="選択したペアの一覧（案件×人材・マッチ度・一致スキル）をコピーします">
                  <span className="material-symbols-outlined" style={{ fontSize: 16, verticalAlign: "-3px" }}>content_copy</span> コピーする
                </button>
                <button type="button" className="btn" onClick={openSchedule}
                  style={{ background: "#0d9488", borderColor: "#0d9488", color: "#fff" }}
                  title="カレンダーで日時を指定すると、その時刻に選択ペアを自動で提案登録＋メール配信します">
                  <span className="material-symbols-outlined" style={{ fontSize: 16, verticalAlign: "-3px" }}>schedule_send</span> 予約配信
                </button>
                <button type="button" className="btn ghost" onClick={() => setSelected(new Set())}>選択解除</button>
              </>
            )}
          </div>
        </div>
      )}

      {/* 予約配信モーダル：カレンダー（日付＋時刻）で配信日時を指定 → cron が自動配信。 */}
      {schedOpen && (
        <div onClick={() => !schedBusy && setSchedOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", zIndex: 420, display: "grid", placeItems: "center", padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "100%", maxWidth: 520, maxHeight: "86vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, display: "inline-flex", alignItems: "center", gap: 6 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 19, color: "#0d9488" }}>schedule_send</span>
                予約配信（{selectedRows.length}件）
              </h3>
              <button type="button" className="btn ghost btn-xs" onClick={() => setSchedOpen(false)} disabled={schedBusy}>閉じる</button>
            </div>

            <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12, fontWeight: 700 }}>
              配信日時（カレンダーから日付と時刻を選択）
              <input type="datetime-local" value={schedAt} min={toLocalInputValue(new Date())}
                onChange={(e) => setSchedAt(e.target.value)}
                style={{ fontFamily: "inherit", fontSize: 14, padding: "10px 12px", borderRadius: 10, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)" }} />
            </label>

            <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.8, background: "var(--color-surface-inset)", borderRadius: 10, padding: "10px 12px" }}>
              指定日時になると、チェックした組み合わせを自動で<b>提案ボードに記録</b>し、
              <b>案件側・人材側へ提案メール</b>（「話を進める／見送り」ボタン付き）を配信します。
              <br />・配信は15分間隔のバッチ処理のため、指定時刻から<b>最大15分ほど</b>遅れることがあります。
              <br />・すでに提案済みのペアは記録のみで、メールの二重送信はしません。
              <br />・配信前であれば下の一覧からキャンセルできます。
            </div>

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" className="btn ghost" onClick={() => setSchedOpen(false)} disabled={schedBusy}>閉じる</button>
              <button type="button" className="btn" onClick={doSchedule} disabled={schedBusy}
                style={{ background: "#0d9488", borderColor: "#0d9488", color: "#fff" }}>
                {schedBusy ? "予約中…" : `この日時で予約する`}
              </button>
            </div>

            {/* 既存の予約一覧（キャンセル可） */}
            <div style={{ borderTop: "1px solid var(--color-border)", paddingTop: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>配信予約の一覧</div>
              {schedList === null ? (
                <div className="muted" style={{ fontSize: 11.5 }}>読み込み中…</div>
              ) : schedList.length === 0 ? (
                <div className="muted" style={{ fontSize: 11.5 }}>予約はありません。</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {schedList.map((s) => (
                    <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, border: "1px solid var(--color-border)", borderRadius: 8, padding: "6px 10px" }}>
                      <span className="tnum" style={{ fontWeight: 700, whiteSpace: "nowrap" }}>
                        {new Date(s.scheduled_at).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </span>
                      <span className="muted" style={{ whiteSpace: "nowrap" }}>{s.pair_count}件</span>
                      <span className="tag" style={{ fontSize: 10, background: s.status === "done" ? "#e7f7ee" : s.status === "error" ? "#fdecef" : "var(--color-surface-inset)", color: s.status === "done" ? "#067647" : s.status === "error" ? "#b42318" : "var(--color-ink-3)", borderColor: "transparent" }}>
                        {SCHEDULE_STATUS_LABEL[s.status] ?? s.status}
                      </span>
                      {s.created_by && <span className="muted" style={{ fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.created_by}</span>}
                      {s.status === "pending" && (
                        <button type="button" className="btn ghost btn-xs" style={{ marginLeft: "auto" }} onClick={() => doCancelSchedule(s.id)}>キャンセル</button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* AI生成結果モーダル：ペアごとの提案文＋全文コピー。 */}
      {aiResults && (
        <div onClick={() => setAiResults(null)} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", zIndex: 420, display: "grid", placeItems: "center", padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "100%", maxWidth: 760, maxHeight: "86vh", display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, display: "inline-flex", alignItems: "center", gap: 6 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 19, color: "#7c5cff" }}>auto_awesome</span>
                AI提案文（{aiResults.length}件）
              </h3>
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" className="btn brand btn-xs"
                  onClick={async () => {
                    const ok = await copyText(aiResults.map((a) => `■ ${a.heading}\n${a.text}`).join("\n\n----------------\n\n"));
                    toast(ok ? "全文をコピーしました" : "コピーに失敗しました", ok ? "success" : "error");
                  }}>全文コピー</button>
                <button type="button" className="btn ghost btn-xs" onClick={() => setAiResults(null)}>閉じる</button>
              </div>
            </div>
            <div style={{ overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
              {aiResults.map((a, i) => (
                <div key={i} style={{ border: "1px solid var(--color-border)", borderRadius: 10, padding: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, flex: 1, minWidth: 0 }}>{a.heading}</div>
                    <button type="button" className="btn ghost btn-xs"
                      onClick={async () => { const ok = await copyText(a.text); toast(ok ? "コピーしました" : "コピーに失敗しました", ok ? "success" : "error"); }}>コピー</button>
                  </div>
                  <div style={{ fontSize: 12.5, whiteSpace: "pre-wrap", lineHeight: 1.7, color: "var(--color-ink-2)" }}>{a.text}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ────────────── 比較ドロワー（案件 × 人材 横並び） ──────────────

function ComparisonDrawer({ p, drawerIn, onClose }: { p: RankedPair; drawerIn: boolean; onClose: () => void }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", zIndex: 400, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={(e) => e.stopPropagation()} className="card"
        style={{
          width: "min(1080px, 96vw)", height: "100vh", maxHeight: "100vh", overflowY: "auto",
          borderRadius: 0, padding: 18, display: "flex", flexDirection: "column", gap: 14,
          transform: drawerIn ? "translateX(0)" : "translateX(100%)",
          transition: "transform .26s cubic-bezier(.22,.61,.36,1)",
        }}>
        {/* ヘッダ */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
            <RankBadge n={p.rank} />
            <div>
              <div className="meta" style={{ fontSize: 10, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--color-ink-4)", fontWeight: 600 }}>比較ビュー · 案件 × 人材</div>
              <h3 style={{ margin: "2px 0 0", fontSize: 17, fontWeight: 800 }}>
                <span style={{ color: "#067647" }}>{p.score}%</span> <span className="muted" style={{ fontSize: 12, fontWeight: 500 }}>総合スコア</span>
                <span style={{ marginLeft: 12, color: "#0b5cab" }}>{p.matchedCount}/{p.jobSkillCount}</span> <span className="muted" style={{ fontSize: 12, fontWeight: 500 }}>必須スキル一致（{p.skillPct}%）</span>
              </h3>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Link href={`/matching?job=${p.job.job_no}&cand=${p.cand.candidate_no}`} className="btn brand btn-xs" style={{ textDecoration: "none" }}>→ 提案画面</Link>
            <button className="btn ghost btn-xs" onClick={onClose}>閉じる</button>
          </div>
        </div>

        {/* スキル比較バー */}
        <div className="card" style={{ padding: 12 }}>
          <div style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--color-ink-4)", fontWeight: 600, marginBottom: 6 }}>スキル比較</div>
          <SkillRow label="✅ 一致" tone="green" items={p.matchedSkills} emptyText="一致スキルなし" />
          {p.missingSkills.length > 0 && <SkillRow label="❌ 案件のみ（人材に無い）" tone="red" items={p.missingSkills} />}
          {p.candExtraSkills.length > 0 && <SkillRow label="➕ 人材の追加スキル" tone="gray" items={p.candExtraSkills.slice(0, 30)} more={Math.max(0, p.candExtraSkills.length - 30)} />}
        </div>

        {/* 案件・人材 横並び */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          {/* 案件 */}
          <div className="card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              <div>
                <div className="meta" style={{ fontSize: 10, letterSpacing: ".08em", textTransform: "uppercase", color: "#0b5cab", fontWeight: 700 }}>📋 JOB · 案件</div>
                <div style={{ fontSize: 15, fontWeight: 800, marginTop: 2 }}>
                  <Link href={`/jobs/${p.job.job_no}`} style={{ color: "var(--color-brand-700)", textDecoration: "none" }}>{p.job.title}</Link>{" "}
                  <span className="mono muted" style={{ fontSize: 11, fontWeight: 500 }}>No.{String(p.job.job_no).padStart(5, "0")}</span>
                </div>
              </div>
              <Link href={`/jobs/${p.job.job_no}`} className="btn ghost btn-xs" style={{ textDecoration: "none" }}>案件ページへ</Link>
            </div>
            <RowKV label="クライアント" v={p.job.client_name} />
            <RowKV label="募集職種"     v={p.job.role_label} />
            <RowKV label="単価"         v={salaryLabel(p.job.salary_min, p.job.salary_max)} />
            <RowKV label="リモート"     v={remoteLabel(p.job.remote_type)} />
            <RowKV label="勤務地"       v={p.job.work_location} />
            <RowKV label="開始希望"     v={p.job.start_date} />
            <RowKV label="商流"         v={p.job.flow_note} />
            <RowKV label="必要スキル"   v={
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {(p.job.skills ?? []).map((s) => (
                  <span key={s} className="tag" style={{ fontSize: 10.5, background: p.matchedSkills.includes(s) ? "#e7f7ee" : "#fff1e6", color: p.matchedSkills.includes(s) ? "#067647" : "#9a5b1a", borderColor: "transparent" }}>{p.matchedSkills.includes(s) ? "✓ " : ""}{s}</span>
                ))}
              </div>
            } />
            {p.job.detail && <details style={{ marginTop: 4 }}>
              <summary style={{ fontSize: 11.5, color: "var(--color-ink-3)", cursor: "pointer" }}>案件詳細を表示</summary>
              <div style={{ marginTop: 6, fontSize: 12, color: "var(--color-ink-2)", whiteSpace: "pre-wrap", background: "var(--color-surface-inset)", padding: 10, borderRadius: 8 }}>{p.job.detail}</div>
            </details>}
          </div>

          {/* 人材 */}
          <div className="card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              <div>
                <div className="meta" style={{ fontSize: 10, letterSpacing: ".08em", textTransform: "uppercase", color: "#5b21b6", fontWeight: 700 }}>👤 PERSON · 人材</div>
                <div style={{ fontSize: 15, fontWeight: 800, marginTop: 2 }}>
                  <Link href={`/people/${p.cand.candidate_no}`} style={{ color: "var(--color-brand-700)", textDecoration: "none" }}>{p.cand.name}</Link>{" "}
                  <span className="mono muted" style={{ fontSize: 11, fontWeight: 500 }}>P-{String(p.cand.candidate_no).padStart(5, "0")}</span>
                  {p.proposed && <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 99, background: "#e8ebef", color: "#5b6675", border: "1px solid #d3d9e0" }}>✓ 提案済み</span>}
                </div>
              </div>
              <Link href={`/people/${p.cand.candidate_no}`} className="btn ghost btn-xs" style={{ textDecoration: "none" }}>人材ページへ</Link>
            </div>
            <RowKV label="職種"       v={p.cand.title} />
            <RowKV label="所属"       v={[p.cand.company, p.cand.affiliation].filter(Boolean).join(" · ") || null} />
            <RowKV label="希望単価"   v={p.cand.rate} />
            <RowKV label="リモート希望" v={p.cand.remote_pref} />
            <RowKV label="勤務地"     v={p.cand.location} />
            <RowKV label="経験"       v={p.cand.exp} />
            <RowKV label="稼働開始"   v={p.cand.avail} />
            <RowKV label="年代/国籍"  v={[p.cand.age_band, p.cand.nationality].filter(Boolean).join(" / ") || null} />
            <RowKV label="保有スキル" v={
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {(p.cand.skills ?? []).slice(0, 40).map((s) => (
                  <span key={s} className="tag" style={{ fontSize: 10.5, background: p.matchedSkills.includes(s) ? "#e7f7ee" : "var(--color-surface-inset)", color: p.matchedSkills.includes(s) ? "#067647" : "var(--color-ink-3)", borderColor: "transparent" }}>{p.matchedSkills.includes(s) ? "✓ " : ""}{s}</span>
                ))}
                {(p.cand.skills?.length ?? 0) > 40 && <span className="muted" style={{ fontSize: 10.5, fontWeight: 600 }}>+{p.cand.skills!.length - 40}</span>}
              </div>
            } />
            {p.cand.note && <details style={{ marginTop: 4 }}>
              <summary style={{ fontSize: 11.5, color: "var(--color-ink-3)", cursor: "pointer" }}>備考を表示</summary>
              <div style={{ marginTop: 6, fontSize: 12, color: "var(--color-ink-2)", whiteSpace: "pre-wrap", background: "var(--color-surface-inset)", padding: 10, borderRadius: 8 }}>{p.cand.note}</div>
            </details>}
          </div>
        </div>
      </div>
    </div>
  );
}

function RowKV({ label, v }: { label: string; v: React.ReactNode }) {
  if (v == null || v === "" || (typeof v === "string" && !v.trim())) return null;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "100px 1fr", gap: 10, padding: "6px 0", borderBottom: "1px dashed var(--color-border)", fontSize: 12.5 }}>
      <div className="muted" style={{ fontSize: 11, fontWeight: 600 }}>{label}</div>
      <div style={{ color: "var(--color-ink)", whiteSpace: "pre-wrap" }}>{v}</div>
    </div>
  );
}

function SkillRow({ label, tone, items, more = 0, emptyText }: { label: string; tone: "green" | "red" | "gray"; items: string[]; more?: number; emptyText?: string }) {
  const palette = tone === "green" ? { fg: "#067647", bg: "#e7f7ee" }
                 : tone === "red"   ? { fg: "#b42318", bg: "#fdecef" }
                 :                    { fg: "var(--color-ink-3)", bg: "var(--color-surface-inset)" };
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "6px 0", borderTop: "1px dashed var(--color-border)" }}>
      <div style={{ minWidth: 180, fontSize: 11.5, fontWeight: 700, color: palette.fg }}>{label} <span className="muted" style={{ fontWeight: 500 }}>{items.length}件</span></div>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", flex: 1 }}>
        {items.length === 0 && emptyText ? <span className="muted" style={{ fontSize: 11 }}>{emptyText}</span> : null}
        {items.map((s) => <span key={s} className="tag" style={{ fontSize: 10.5, background: palette.bg, color: palette.fg, borderColor: "transparent" }}>{s}</span>)}
        {more > 0 && <span className="muted" style={{ fontSize: 10.5, fontWeight: 600 }}>+{more}</span>}
      </div>
    </div>
  );
}
