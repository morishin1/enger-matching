"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { submitClientFeedback } from "@/app/portal/actions";
import type { Verdict } from "@/lib/client-feedback";

// docs/business-dashboard-v2-仕様.md §3「候補者・応募者（全媒体一括管理）」の一括ビュー＋ドロワー。
//   経路（エージェント提案／LINE／直接応募 等）を問わず、自社案件に来た人材を1画面に集約する。
//   データ源は proposals（LP応募もDBトリガで proposals にミラーされる。§3）。詳細はドロワーで、
//   ページ遷移せずに匿名プロフィール・選考ステージ・フィードバック（会いたい/検討中/ミスマッチ）を扱う。

export type SelectionItem = {
  id: string;                 // proposal id（フィードバックのキー）
  jobId: string | null;
  jobTitle: string | null;
  stage: string | null;
  routeKey: string;           // deriveRoute の結果（agent/direct/line/indeed/en/other）
  createdAt: string | null;   // 受信日
  stageUpdatedAt: string | null;
  initials: string | null;
  title: string | null;       // 職種
  skills: string[];
  rate: string | null;        // 希望単価
  exp: string | null;
  remotePref: string | null;
  avail: string | null;
  ageBand: string | null;
  nationality: string | null;
  score: number | null;       // マッチ度
  verdict: Verdict | null;
  reason: string | null;
};

// 経路（source）バッジ。ステージが進んでも色は変えない（一目で流入経路が分かるように）。
//   Indeed / エン転職 等の媒体は §7 Phase2 で source が付与され次第ここに増やすだけで表示される。
const ROUTE_META: Record<string, { label: string; color: string; bg: string }> = {
  agent:  { label: "エージェント提案", color: "#0b5cab", bg: "#eaf4fd" },
  direct: { label: "応募",           color: "#067647", bg: "#e7f7ee" },
  line:   { label: "LINE",           color: "#04884b", bg: "#e6f7ee" },
  indeed: { label: "Indeed",         color: "#1d3b8b", bg: "#eef2ff" },
  en:     { label: "エン転職",         color: "#b45309", bg: "#fff5e6" },
  other:  { label: "その他",          color: "#6b7280", bg: "#eef0f3" },
};
const routeMeta = (k: string) => ROUTE_META[k] ?? ROUTE_META.other;

const STAGE_STEPS = ["応募", "書類選考", "面談", "面談合格", "稼働"];
const STAGE_TONE: Record<string, string> = {
  "応募": "#64748b", "書類選考": "#64748b", "面談": "#0b5cab",
  "面談合格": "#0b5cab", "稼働": "#067647", "見送り": "#b42318",
};
const stageTone = (s?: string | null) => (s && STAGE_TONE[s]) || "#64748b";

const VERDICTS: { v: Verdict; label: string; emoji: string; tone: { bg: string; fg: string; bd: string } }[] = [
  { v: "want", label: "会いたい", emoji: "👍", tone: { bg: "#e7f7ee", fg: "#067647", bd: "#067647" } },
  { v: "maybe", label: "検討中", emoji: "🤔", tone: { bg: "#fff5e6", fg: "#b45309", bd: "#b45309" } },
  { v: "mismatch", label: "ミスマッチ", emoji: "👎", tone: { bg: "#fdecef", fg: "#b42318", bd: "#b42318" } },
];
const verdictMeta = (v: Verdict | null) => VERDICTS.find((x) => x.v === v) ?? null;

function matchLabel(score: number | null) {
  const s = score ?? 0;
  if (s >= 80) return { t: "高マッチ", c: "#067647", bg: "#e7f7ee" };
  if (s >= 60) return { t: "中マッチ", c: "#0b5cab", bg: "#eaf4fd" };
  return { t: "要検討", c: "#6b7280", bg: "#eef0f3" };
}

const fmtDate = (s: string | null) => {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

export function PortalSelectionView({ items: initial, companyName, jobOptions }: { items: SelectionItem[]; companyName: string | null; jobOptions: { id: string; title: string }[] }) {
  // フィードバックの結果を一覧バッジへ即時反映するため items をローカル状態で保持。
  const [items, setItems] = useState<SelectionItem[]>(initial);
  const [route, setRoute] = useState<string>("all");
  const [stage, setStage] = useState<string>("all");
  const [job, setJob] = useState<string>("all");
  const [openId, setOpenId] = useState<string | null>(null);

  // 一覧に実在する経路のみをフィルタ候補にする（空の選択肢を出さない）。
  const routeChoices = useMemo(() => {
    const set = new Set(items.map((i) => i.routeKey));
    return Array.from(set);
  }, [items]);
  const stageChoices = useMemo(() => {
    const set = new Set(items.map((i) => i.stage || "応募"));
    return STAGE_STEPS.concat("見送り").filter((s) => set.has(s));
  }, [items]);

  const filtered = useMemo(() => {
    const rows = items.filter((i) =>
      (route === "all" || i.routeKey === route) &&
      (stage === "all" || (i.stage || "応募") === stage) &&
      (job === "all" || i.jobId === job)
    );
    // 既定は「対応が必要な順」＝企業未回答（verdict なし）を先頭に、次いで受信が新しい順。
    return rows.slice().sort((a, b) => {
      const na = a.verdict == null ? 0 : 1;
      const nb = b.verdict == null ? 0 : 1;
      if (na !== nb) return na - nb;
      return String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? ""));
    });
  }, [items, route, stage, job]);

  const stageCounts = useMemo(() => {
    return items.reduce((m: Record<string, number>, r) => {
      const s = r.stage || "応募";
      m[s] = (m[s] ?? 0) + 1;
      return m;
    }, {});
  }, [items]);
  const needsAction = items.filter((i) => i.verdict == null).length;

  const openItem = items.find((i) => i.id === openId) ?? null;

  const onFeedbackSaved = (id: string, verdict: Verdict, reason: string) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, verdict, reason: reason || null } : i)));
  };

  return (
    <>
      {/* 選考ステージの件数（対応が必要な件数を先頭に強調）。 */}
      <div className="kpi-grid" style={{ marginBottom: 14 }}>
        <div className="kpi"><div><div className="val tnum" style={{ color: needsAction > 0 ? "#b45309" : undefined }}>{needsAction}</div><div className="label">要対応（未回答）</div></div></div>
        {STAGE_STEPS.map((s) => (
          <div key={s} className="kpi"><div><div className="val tnum">{stageCounts[s] ?? 0}</div><div className="label">{s}</div></div></div>
        ))}
      </div>

      {/* フィルタ：経路 / ステージ / 案件（§3）。 */}
      <div className="card" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", padding: "10px 14px", marginBottom: 12 }}>
        <span className="muted" style={{ fontSize: 11.5, fontWeight: 700 }}>絞り込み</span>
        <FilterSelect label="経路" value={route} onChange={setRoute}
          options={[{ value: "all", label: "すべての経路" }, ...routeChoices.map((k) => ({ value: k, label: routeMeta(k).label }))]} />
        <FilterSelect label="ステージ" value={stage} onChange={setStage}
          options={[{ value: "all", label: "すべてのステージ" }, ...stageChoices.map((s) => ({ value: s, label: s }))]} />
        {jobOptions.length > 1 && (
          <FilterSelect label="案件" value={job} onChange={setJob}
            options={[{ value: "all", label: "すべての案件" }, ...jobOptions.map((j) => ({ value: j.id, label: j.title }))]} />
        )}
        <span style={{ marginLeft: "auto", fontSize: 11.5, color: "var(--color-ink-4)" }}>{filtered.length} 件</span>
      </div>

      {filtered.length === 0 ? (
        <div className="card" style={{ fontSize: 13, color: "var(--color-ink-3)" }}>
          該当する候補者・応募者はいません。条件を変えるか、<a href="/portal/jobs" style={{ color: "var(--color-brand-700)", fontWeight: 700 }}>案件を掲載</a>すると人材からの応募がここに集まります。
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {filtered.map((r) => <Row key={r.id} r={r} onOpen={() => setOpenId(r.id)} />)}
        </div>
      )}

      {openItem && (
        <Drawer item={openItem} companyName={companyName} onClose={() => setOpenId(null)} onSaved={onFeedbackSaved} />
      )}
    </>
  );
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--color-ink-4)" }}>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}
        style={{ fontFamily: "inherit", fontSize: 12, padding: "5px 8px", borderRadius: 8, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)" }}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

function Row({ r, onOpen }: { r: SelectionItem; onOpen: () => void }) {
  const rm = routeMeta(r.routeKey);
  const vm = verdictMeta(r.verdict);
  const skills = r.skills.slice(0, 4);
  const moreSkills = r.skills.length - skills.length;
  return (
    <button onClick={onOpen} className="card"
      style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", padding: "12px 14px", width: "100%", textAlign: "left", cursor: "pointer", border: "1px solid var(--color-border)", background: "var(--color-surface)" }}>
      <div className="ava" style={{ width: 40, height: 40, flex: "0 0 40px" }}>{r.initials || "—"}</div>
      <div style={{ minWidth: 0, flex: "1 1 260px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13.5, fontWeight: 700 }}>{r.title || "職種未設定"}</span>
          {r.verdict == null && <span style={{ fontSize: 10, fontWeight: 800, padding: "1px 7px", borderRadius: 99, background: "#fff5e6", color: "#b45309" }}>要対応</span>}
        </div>
        <div className="muted" style={{ fontSize: 11, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {[r.jobTitle, r.rate].filter(Boolean).join(" · ") || "—"}
        </div>
        {skills.length > 0 && (
          <div style={{ marginTop: 5 }}>
            {skills.map((s) => (
              <span key={s} style={{ display: "inline-block", fontSize: 10.5, padding: "2px 8px", borderRadius: 999, background: "var(--color-brand-25)", color: "var(--color-ink-3)", margin: "2px 4px 0 0" }}>{s}</span>
            ))}
            {moreSkills > 0 && <span className="muted" style={{ fontSize: 10.5 }}>＋{moreSkills}</span>}
          </div>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5, flex: "0 0 auto" }}>
        <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 999, color: rm.color, background: rm.bg }}>{rm.label}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {vm && <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 999, color: vm.tone.fg, background: vm.tone.bg }}>{vm.emoji} {vm.label}</span>}
          <span style={{ fontSize: 11.5, fontWeight: 700, padding: "3px 10px", borderRadius: 999, color: "#fff", background: stageTone(r.stage) }}>{r.stage || "応募"}</span>
        </div>
        <span className="muted" style={{ fontSize: 10.5 }}>受信 {fmtDate(r.createdAt)}</span>
      </div>
    </button>
  );
}

function Drawer({ item, companyName, onClose, onSaved }: { item: SelectionItem; companyName: string | null; onClose: () => void; onSaved: (id: string, v: Verdict, r: string) => void }) {
  // ドロワー表示中は背景スクロールを固定し、Esc で閉じる。
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", onKey); };
  }, [onClose]);

  const rm = routeMeta(item.routeKey);
  const ml = matchLabel(item.score);
  const curStageIdx = STAGE_STEPS.indexOf(item.stage || "応募");
  const isLost = item.stage === "見送り";

  const profile: { k: string; v: string | null }[] = [
    { k: "経験", v: item.exp },
    { k: "希望単価", v: item.rate },
    { k: "リモート", v: item.remotePref },
    { k: "稼働", v: item.avail },
    { k: "年代", v: item.ageBand },
    { k: "国籍", v: item.nationality },
  ];

  return (
    <div role="dialog" aria-modal="true" aria-label="候補者の詳細"
      style={{ position: "fixed", inset: 0, zIndex: 70, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={onClose} aria-hidden style={{ position: "absolute", inset: 0, background: "rgba(8,15,30,.42)" }} />
      <aside style={{ position: "relative", width: "min(480px, 100%)", height: "100%", background: "var(--color-surface)", boxShadow: "-14px 0 40px rgba(0,0,0,.18)", display: "flex", flexDirection: "column", animation: "none" }}>
        {/* ヘッダー */}
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--color-border)", display: "flex", alignItems: "flex-start", gap: 12 }}>
          <div className="ava" style={{ width: 46, height: 46, flex: "0 0 46px" }}>{item.initials || "—"}</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 15.5, fontWeight: 800 }}>{item.title || "職種未設定"}</div>
            <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{item.jobTitle || "—"}</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 7 }}>
              <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 999, color: rm.color, background: rm.bg }}>{rm.label}</span>
              <span style={{ fontSize: 11.5, fontWeight: 700, padding: "3px 10px", borderRadius: 999, color: "#fff", background: stageTone(item.stage) }}>{item.stage || "応募"}</span>
              {item.score != null && item.score > 0 && (
                <span style={{ fontSize: 11, fontWeight: 800, padding: "3px 10px", borderRadius: 999, background: ml.bg, color: ml.c }}>{ml.t} {Math.round(item.score)}</span>
              )}
            </div>
          </div>
          <button onClick={onClose} aria-label="閉じる" title="閉じる"
            style={{ flex: "0 0 auto", background: "transparent", border: 0, cursor: "pointer", color: "var(--color-ink-4)", display: "inline-flex" }}>
            <span className="material-symbols-outlined" style={{ fontSize: 22 }}>close</span>
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
          {/* 匿名を明示（氏名・連絡先は担当が仲介）。 */}
          <div className="muted" style={{ fontSize: 11, marginBottom: 14 }}>氏名・連絡先は担当エージェントが仲介します（この画面は匿名情報のみ）。</div>

          {/* 選考ステージのタイムライン */}
          <SectionTitle>選考ステージ</SectionTitle>
          <div style={{ display: "flex", alignItems: "center", gap: 0, margin: "6px 0 4px" }}>
            {STAGE_STEPS.map((s, idx) => {
              const done = !isLost && idx <= curStageIdx;
              const isCur = !isLost && idx === curStageIdx;
              return (
                <div key={s} style={{ flex: idx === 0 ? "0 0 auto" : "1 1 0", display: "flex", alignItems: "center", minWidth: 0 }}>
                  {idx > 0 && <div style={{ height: 2, flex: 1, background: done ? "#067647" : "var(--color-border)" }} />}
                  <div title={s} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                    <div style={{ width: isCur ? 14 : 11, height: isCur ? 14 : 11, borderRadius: 99, flex: "0 0 auto", background: done ? "#067647" : "var(--color-border-strong)", boxShadow: isCur ? "0 0 0 3px #e7f7ee" : "none" }} />
                    <span style={{ fontSize: 9.5, fontWeight: isCur ? 800 : 600, color: done ? "var(--color-ink-2)" : "var(--color-ink-4)", whiteSpace: "nowrap" }}>{s}</span>
                  </div>
                </div>
              );
            })}
          </div>
          {isLost && <div style={{ fontSize: 11.5, color: "#b42318", fontWeight: 700, marginTop: 4 }}>見送り</div>}
          <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>受信 {fmtDate(item.createdAt)}{item.stageUpdatedAt ? ` ・ 最終更新 ${fmtDate(item.stageUpdatedAt)}` : ""}</div>

          {/* スキル（全件） */}
          <SectionTitle>スキル</SectionTitle>
          {item.skills.length > 0 ? (
            <div>
              {item.skills.map((s) => (
                <span key={s} style={{ display: "inline-block", fontSize: 11, padding: "3px 9px", borderRadius: 999, background: "var(--color-brand-25)", color: "var(--color-ink-2)", margin: "2px 5px 2px 0", fontWeight: 600 }}>{s}</span>
              ))}
            </div>
          ) : <div className="muted" style={{ fontSize: 12 }}>—</div>}

          {/* プロフィール（匿名） */}
          <SectionTitle>プロフィール</SectionTitle>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "8px 14px" }}>
            {profile.map((p) => (
              <div key={p.k}>
                <div className="muted" style={{ fontSize: 10.5 }}>{p.k}</div>
                <div style={{ fontSize: 12.5, fontWeight: 600 }}>{p.v || "—"}</div>
              </div>
            ))}
          </div>
        </div>

        {/* アクション：会いたい / 検討中 / ミスマッチ（§3） */}
        <FeedbackBar item={item} onSaved={onSaved} />
      </aside>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 11.5, fontWeight: 800, color: "var(--color-ink-3)", letterSpacing: ".02em", margin: "16px 0 7px" }}>{children}</div>;
}

function FeedbackBar({ item, onSaved }: { item: SelectionItem; onSaved: (id: string, v: Verdict, r: string) => void }) {
  const [verdict, setVerdict] = useState<Verdict | null>(item.verdict);
  const [reason, setReason] = useState(item.reason ?? "");
  const [showReason, setShowReason] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const save = (v: Verdict, r: string) => start(async () => {
    setErr(null);
    const res = await submitClientFeedback(item.id, v, r);
    if (res.ok) { setSaved(true); setShowReason(false); onSaved(item.id, v, r); }
    else setErr(res.error ?? "保存に失敗しました");
  });
  const choose = (v: Verdict) => {
    setVerdict(v); setSaved(false); setErr(null);
    if (v === "mismatch") { setShowReason(true); return; } // 理由を促す
    save(v, reason);
  };

  return (
    <div style={{ borderTop: "1px solid var(--color-border)", padding: "12px 20px", background: "var(--color-bg)" }}>
      <div style={{ display: "flex", gap: 8 }}>
        {VERDICTS.map((b) => {
          const active = verdict === b.v;
          return (
            <button key={b.v} onClick={() => choose(b.v)} disabled={pending}
              style={{ flex: "1 1 0", minWidth: 0, padding: "9px 6px", borderRadius: 9, cursor: pending ? "default" : "pointer", fontSize: 12.5, fontWeight: 700,
                border: active ? `1.5px solid ${b.tone.bd}` : "1px solid var(--color-border-strong)",
                background: active ? b.tone.bg : "var(--color-surface)", color: active ? b.tone.fg : "var(--color-ink-3)" }}>
              {b.emoji} {b.label}
            </button>
          );
        })}
      </div>
      {(showReason || verdict === "mismatch") && (
        <div style={{ marginTop: 8 }}>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
            placeholder="どこがミスマッチでしたか？（例：スキルは合うが単価が高い / リモート不可がNG など）次回提案の精度向上に使います"
            style={{ width: "100%", padding: "8px 10px", border: "1px solid var(--color-border-strong)", borderRadius: 8, fontSize: 12.5, fontFamily: "inherit", resize: "vertical", background: "var(--color-surface)", color: "var(--color-ink)" }} />
          <button onClick={() => save("mismatch", reason)} disabled={pending}
            style={{ marginTop: 6, padding: "7px 14px", borderRadius: 8, border: 0, background: "#b42318", color: "#fff", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
            ミスマッチとして送信
          </button>
        </div>
      )}
      {saved && <div style={{ fontSize: 11.5, color: "#067647", marginTop: 7 }}>✓ 評価を保存しました。担当エージェントが面談調整・実名確認を仲介します。</div>}
      {err && <div style={{ fontSize: 11.5, color: "#b42318", marginTop: 7 }}>{err}</div>}
    </div>
  );
}
