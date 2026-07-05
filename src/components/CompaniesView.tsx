"use client";

import { useMemo, useState } from "react";
import Link from "@/components/AppLink";
import { useRouter } from "next/navigation";
import { Icons } from "./icons";
import { targetScore, prospectAction, companyIdLabel, type CompanyRow, type ProspectAction } from "@/lib/companies";
import { StarsView } from "./Stars";
import type { CompanyRating } from "@/lib/company-ratings";
import { saveCompany, deleteCompany, setCompanyMeetingDone, bulkSetCompaniesMeetingDone, diagnoseCompanyMeetingDone, summarizeCompanyReputation, type CompanyDiagnosis } from "@/lib/actions";
import { ReferralPortalSection } from "./ReferralPortalSection";

type Registered = {
  name: string; industry?: string | null; tier?: string | null; status?: string | null;
  owner_staff?: string | null; contact_name?: string | null; contact_email?: string | null;
  phone?: string | null; website?: string | null; address?: string | null; note?: string | null;
  meeting_done?: boolean | null; meeting_done_at?: string | null;
  company_no?: number | null; // #293：企業ID（自動採番）。提案管理の自社担当連携のキー。
  // 対応特性タグ（属人知の資産化）＋取引注意（既存 caution 列を編集・表示）
  contact_pref?: string | null; response_speed?: string | null; decision_speed?: string | null;
  caution?: boolean | null; caution_reason?: string | null; caution_at?: string | null;
  // WEB評判のAI要約（参考情報・要確認）
  web_reputation?: string | null; web_reputation_source?: string | null; web_reputation_at?: string | null;
};

// 「打合せ済」判定：
//   ・手動チェック true なら常に「済」
//   ・手動チェックを外している（false かつ meeting_done_at が立つ＝ユーザーが明示的に外した）なら「未」（メ記録があっても解除を優先）
//   ・どちらでもない（未設定）場合のみ、打合せ記録(meeting_count>0)を fallback として「済」と判定
const isMeetingDone = (c: { meeting_count?: number; reg?: Registered }) => {
  const reg = c.reg;
  if (reg?.meeting_done === true) return true;
  if (reg?.meeting_done === false && reg?.meeting_done_at) return false; // 明示的に「未」
  return (c.meeting_count ?? 0) > 0;
};
type Merged = CompanyRow & { score: number; reasons: string[]; reg?: Registered; registered: boolean; action: ProspectAction; candidate_count: number };

const sentTone = (s?: string | null) => !s ? null : s.includes("ポジ") ? { c: "#1aa260", t: s } : s.includes("ネガ") ? { c: "#d23f57", t: s } : s.includes("競合") ? { c: "#d98a2b", t: s } : { c: "#6b7280", t: s };
const scoreColor = (n: number) => n >= 70 ? "#1aa260" : n >= 45 ? "#0095D9" : n >= 25 ? "#d98a2b" : "#9aa7b4";
const PALETTE = ["#0095D9", "#7c5cff", "#1aa260", "#e0567f", "#d98a2b", "#3aa6b9", "#b5651d"];
const colorOf = (s: string) => PALETTE[Array.from(s).reduce((a, c) => a + c.charCodeAt(0), 0) % PALETTE.length];
const initialsOf = (name: string) => name.replace(/(株式会社|有限会社|\(株\)|（株）)/g, "").trim().slice(0, 2) || name.slice(0, 2);
const dateLabel = (d?: string | null) => { if (!d) return "—"; const dt = new Date(d); return isNaN(dt.getTime()) ? "—" : `${dt.getFullYear()}/${dt.getMonth() + 1}/${dt.getDate()}`; };
const tierStyle = (t: string) => t === "A" ? { bg: "var(--color-brand-50)", color: "var(--color-brand-700)", border: "var(--color-brand-100)" }
  : t === "B" ? { bg: "#fef3e2", color: "#a35f15", border: "#f6d9a7" } : { bg: "var(--color-surface-inset)", color: "var(--color-ink-3)", border: "var(--color-border)" };
const statusColor = (s: string) => s === "主要" ? "var(--color-brand-600)" : s === "拡大中" ? "#10b981" : s === "新規" ? "#7a5cc4" : "var(--color-ink-4)";

type SortKey = "target" | "job_count" | "active_jobs" | "candidate_count" | "avg_rate" | "last_job_at";

export function CompaniesView({ companies, registered = [], candidateCounts = {}, lineCompanies = [], ratings = {}, feedback = {} }: { companies: CompanyRow[]; registered?: Registered[]; candidateCounts?: Record<string, number>; lineCompanies?: string[]; ratings?: Record<string, CompanyRating>; feedback?: Record<string, { want: number; maybe: number; mismatch: number }> }) {
  // LINE でやり取りしている企業（正規化名の Set）。一覧で「💬 LINE」バッジを出すために使う。
  const lineSet = useMemo(() => new Set(lineCompanies.map((n) => (n ?? "").replace(/^[\s　]+|[\s　]+$/g, ""))), [lineCompanies]);
  const isLineCompany = (name: string) => lineSet.has((name ?? "").replace(/^[\s　]+|[\s　]+$/g, ""));
  const [tier, setTier] = useState("ALL");
  const [act, setAct] = useState("ALL");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("target");
  const [modal, setModal] = useState<Merged | "new" | null>(null);
  const [showAll, setShowAll] = useState(false);
  // 表示形式：既定はリスト（件数が多く一覧性が高いため）。カードに切替可。
  const [view, setView] = useState<"list" | "card">("list");
  // 打合せ状況フィルタ：全て / 打合せ済 / 未打合せ。
  //   このデータ整備画面の主軸＝「打合せ済かどうか」。既定は未打合せ（＝これから打合せが必要な
  //   対応すべき企業の TODO リスト）を表示する。済/全ては上部の主役タブでワンクリック切替。
  const [mtg, setMtg] = useState<"ALL" | "done" | "none">("none");
  // 登録状況フィルタ：全て / 登録済み（企業マスタに手動登録あり） / 未登録（案件から自動集約のみ）
  const [regF, setRegF] = useState<"ALL" | "reg" | "unreg">("ALL");
  // 種別フィルタ：案件提供 / 人材提供 / 両方 / 全て
  const [kind, setKind] = useState<"ALL" | "job" | "cand" | "both">("ALL");
  // LINE 絞り込み：ON で LINE 経由のやり取りがある企業のみ表示
  const [lineOnly, setLineOnly] = useState(false);
  // 一括選択（チェックボックス）。下部のフローティングメニューから「打合せ完了/解除」を一括適用。
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMsg, setBulkMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // 企業名を貼り付けて一括で「打合せ済み（承認）」登録するパネル。
  //   未登録の企業名でも bulkSetCompaniesMeetingDone が新規作成＋meeting_done=true にする。
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasteBusy, setPasteBusy] = useState(false);
  const [pasteMsg, setPasteMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const submitPaste = async (done: boolean) => {
    const names = Array.from(new Set(
      pasteText.split(/\r?\n|,|、|\t/).map((s) => s.trim()).filter(Boolean)
    ));
    if (names.length === 0) { setPasteMsg({ ok: false, text: "企業名を入力してください（1行に1社）" }); return; }
    setPasteBusy(true); setPasteMsg(null);
    try {
      const res = await bulkSetCompaniesMeetingDone(names, done);
      if (res.ok) {
        setPasteMsg({ ok: true, text: `${res.updated} 社を${done ? "打合せ済み（承認）で登録/更新" : "未打合せに更新"}しました` });
        setPasteText("");
        router.refresh();
      } else {
        setPasteMsg({ ok: false, text: res.error ?? "登録に失敗しました" });
      }
    } catch (e) {
      setPasteMsg({ ok: false, text: e instanceof Error ? e.message : "登録に失敗しました" });
    } finally { setPasteBusy(false); }
  };
  const toggleSel = (name: string) => setSelected((prev) => { const next = new Set(prev); next.has(name) ? next.delete(name) : next.add(name); return next; });
  const clearSel = () => setSelected(new Set());
  const doBulkMeetingDone = async (done: boolean) => {
    const names = [...selected];
    if (names.length === 0) return;
    setBulkBusy(true); setBulkMsg(null);
    try {
      const res = await bulkSetCompaniesMeetingDone(names, done);
      if (res.ok) {
        setBulkMsg({ ok: true, text: `${res.updated} 社を${done ? "打合せ完了に" : "未打合せに"}しました` });
        clearSel(); router.refresh();
      } else {
        setBulkMsg({ ok: false, text: res.error ?? "更新に失敗しました" });
      }
    } catch (e) {
      setBulkMsg({ ok: false, text: e instanceof Error ? e.message : "更新に失敗しました" });
    } finally {
      setBulkBusy(false);
      setTimeout(() => setBulkMsg(null), 5000);
    }
  };

  // 企業名の突合キー。書き込み側(setCompanyMeetingDone等)は trim した名前で保存するため、
  // 案件メール由来の企業名に前後の空白/全角スペースが紛れていると、生の名前では永遠に一致しない。
  // → 突合は正規化（前後の空白・全角スペース除去）した名前で行う（表示は元の名前のまま）。
  const normName = (s?: string | null) => (s ?? "").replace(/^[\s　]+|[\s　]+$/g, "");
  // 企業評価★（失注時の案件★平均）。企業名を正規化して引けるようにする。
  const ratingByKey = useMemo(() => { const m: Record<string, CompanyRating> = {}; for (const [k, v] of Object.entries(ratings)) m[normName(k)] = v; return m; }, [ratings]);
  const ratingOf = (name: string): CompanyRating | undefined => ratingByKey[normName(name)];
  const regMap = useMemo(() => {
    const m = new Map<string, Registered>();
    for (const r of registered) { const k = normName(r.name); if (k && !m.has(k)) m.set(k, r); }
    return m;
  }, [registered]);

  // 企業名 → 人材数（page.tsx 側で candidates の所属企業から集計済み）。正規化キーで突合。
  const candCountByKey = useMemo(() => {
    const m = new Map<string, number>();
    for (const [k, v] of Object.entries(candidateCounts ?? {})) {
      const nk = normName(k);
      if (!nk) continue;
      m.set(nk, (m.get(nk) ?? 0) + (Number(v) || 0));
    }
    return m;
  }, [candidateCounts]);
  const candCountOf = (name: string) => candCountByKey.get(normName(name)) ?? 0;

  // 企業名(正規化) → 企業評価(会いたい/ミスマッチ)件数。決まりやすさ係数に注入する。
  const fbOf = (name: string) => feedback[normName(name)] ?? feedback[name] ?? { want: 0, maybe: 0, mismatch: 0 };

  const merged: Merged[] = useMemo(() => {
    const list: Merged[] = companies.map((c) => {
      const reg = regMap.get(normName(c.name));
      const withReg = { ...c, tier: (reg?.tier as any) || c.tier, status: reg?.status || c.status } as CompanyRow;
      const candidate_count = candCountOf(c.name);
      const fb = fbOf(c.name);
      const opts = { caution: reg?.caution ?? false, want: fb.want, mismatch: fb.mismatch };
      return { ...withReg, ...targetScore(withReg, opts), action: prospectAction(withReg), reg, registered: !!reg, candidate_count };
    });
    // 案件が無い登録企業も表示
    const inDerived = new Set(companies.map((c) => normName(c.name)));
    for (const r of registered) {
      if (inDerived.has(normName(r.name))) continue;
      const base: CompanyRow = { name: r.name, job_count: 0, active_jobs: 0, focus_jobs: 0, last_job_at: null, avg_rate: null, tier: (r.tier as any) || "C", status: r.status || "新規", proposals_total: 0, won: 0, lost: 0, last_sentiment: null, last_relation: null, last_meeting_at: null, meeting_count: 0 };
      const fb = fbOf(r.name);
      list.push({ ...base, ...targetScore(base, { caution: r?.caution ?? false, want: fb.want, mismatch: fb.mismatch }), action: prospectAction(base), reg: r, registered: true, candidate_count: candCountOf(r.name) });
    }
    return list;
  }, [companies, registered, regMap, feedback]);

  const counts = useMemo(() => ({ ALL: merged.length, A: merged.filter((c) => c.tier === "A").length, B: merged.filter((c) => c.tier === "B").length, C: merged.filter((c) => c.tier === "C").length }), [merged]);
  const actCounts = useMemo(() => ({
    hot: merged.filter((c) => c.action?.key === "hot").length,
    reapproach: merged.filter((c) => c.action?.key === "reapproach").length,
    new: merged.filter((c) => c.action?.key === "new").length,
    recover: merged.filter((c) => c.action?.key === "recover").length,
  }), [merged]);
  // 打合せ状況の件数（主役フィルタ用）
  const mtgCounts = useMemo(() => {
    const done = merged.filter((c) => isMeetingDone(c)).length;
    return { ALL: merged.length, done, none: merged.length - done };
  }, [merged]);
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    // 企業ID検索用：入力が「IDらしい」（数字/ C / - / # / 空白のみ）ときだけ数字部分で company_no と部分一致。
    //   これにより通常の社名検索（数字を含む社名など）まで巻き込まないようにする。
    const idLike = needle !== "" && /^[\s#c\-0-9]+$/.test(needle);
    const needleDigits = idLike ? needle.replace(/\D/g, "") : "";
    const rows = merged.filter((c) =>
      (tier === "ALL" || c.tier === tier)
      && (act === "ALL" || c.action?.key === act)
      && (mtg === "ALL" || (mtg === "done" ? isMeetingDone(c) : !isMeetingDone(c)))
      && (regF === "ALL" || (regF === "reg" ? c.registered : !c.registered))
      && (kind === "ALL" || (() => {
        const hasJ = (c.job_count ?? 0) > 0, hasC = (c.candidate_count ?? 0) > 0;
        if (kind === "job") return hasJ && !hasC;
        if (kind === "cand") return hasC && !hasJ;
        if (kind === "both") return hasJ && hasC;
        return true;
      })())
      // LINE 絞り込み：ON のとき LINE でやり取りしている企業のみ表示
      && (!lineOnly || isLineCompany(c.name))
      // 企業名・業種・窓口担当者・企業ID でも検索できるように（#297②：企業IDの部分一致も対象）。
      //   企業IDは "C-00001" 表記でも数字だけ "1"/"00001" でも部分一致する（記号・接頭辞を無視して照合）。
      && (!needle || c.name.toLowerCase().includes(needle)
        || (c.reg?.industry ?? "").toLowerCase().includes(needle)
        || (c.reg?.contact_name ?? "").toLowerCase().includes(needle)
        || (c.reg?.owner_staff ?? "").toLowerCase().includes(needle)
        || (companyIdLabel(c.reg?.company_no ?? null) ?? "").toLowerCase().includes(needle)
        || (c.reg?.company_no != null && needleDigits !== "" && String(c.reg.company_no).includes(needleDigits))));
    return [...rows].sort((a, b) => sort === "last_job_at" ? (b.last_job_at ?? "").localeCompare(a.last_job_at ?? "") : ((b as any)[sort] ?? 0) - ((a as any)[sort] ?? 0));
  }, [merged, tier, act, search, sort, mtg, regF, kind, lineOnly]);
  const top = useMemo(() => [...merged].sort((a, b) => b.score - a.score).slice(0, 5), [merged]);

  const PAGE = 20;
  const visible = useMemo(() => (showAll ? filtered : filtered.slice(0, PAGE)), [filtered, showAll]);

  return (
    <>
      <div className="card" style={{ background: "var(--color-brand-25)", borderColor: "var(--color-brand-100)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <h3 style={{ margin: 0, fontSize: 13.5, fontWeight: 700 }}>🎯 今狙うべき企業 TOP5</h3>
          <span className="muted" style={{ fontSize: 11 }}>供給力 × 実績 × 温度感 × 関係性 × 鮮度</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
          {top.map((c, i) => (
            <button key={c.name} onClick={() => setModal(c)} style={{ textAlign: "left", cursor: "pointer", color: "inherit", display: "flex", gap: 10, alignItems: "center", background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 12, padding: "10px 12px" }}>
              <div className="display tnum" style={{ width: 36, height: 36, borderRadius: 10, flex: "0 0 36px", display: "grid", placeItems: "center", background: `${scoreColor(c.score)}1a`, color: scoreColor(c.score), fontWeight: 800 }}>{c.score}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{i + 1}. {c.name}</div>
                <div className="muted" style={{ fontSize: 10.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.reasons.join(" / ") || `募集中${c.active_jobs}件`}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* 開拓アクション（アウトサイドの動線） */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <span className="muted" style={{ fontSize: 11.5, fontWeight: 700 }}>開拓アクション</span>
        {[
          { id: "ALL", label: "全て", tone: "var(--color-ink-3)", n: merged.length },
          { id: "hot", label: "🔥 ポジ→深掘り", tone: "#1aa260", n: actCounts.hot },
          { id: "reapproach", label: "🌥 再アプローチ", tone: "#d98a2b", n: actCounts.reapproach },
          { id: "new", label: "🆕 新規フォロー", tone: "#7a5cc4", n: actCounts.new },
          { id: "recover", label: "💔 失注リカバリ", tone: "#d23f57", n: actCounts.recover },
        ].map((a) => (
          <button key={a.id} onClick={() => { setAct(a.id); setShowAll(false); }} style={{ padding: "5px 11px", borderRadius: 99, fontSize: 12, fontWeight: 700, fontFamily: "inherit", cursor: "pointer",
            border: `1px solid ${act === a.id ? a.tone : "var(--color-border)"}`, background: act === a.id ? `${a.tone}1a` : "var(--color-surface)", color: act === a.id ? a.tone : "var(--color-ink-3)" }}>
            {a.label} <span className="tnum" style={{ marginLeft: 3 }}>{a.n}</span>
          </button>
        ))}
      </div>

      {/* 主役フィルタ：打合せ状況（このデータ整備画面の最重要軸）。大きめのセグメントで件数つき。 */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12.5, fontWeight: 800, color: "var(--color-ink-2)" }}>打合せ状況</span>
        <div style={{ display: "inline-flex", gap: 6, padding: 4, background: "var(--color-surface-inset)", borderRadius: 12, flexWrap: "wrap" }}>
          {[
            { id: "none", label: "未打合せ", n: mtgCounts.none, fg: "#b42318", bg: "#fdecef", bd: "#f7c5cf", icon: "schedule" },
            { id: "done", label: "打合せ済", n: mtgCounts.done, fg: "#067647", bg: "#e7f7ee", bd: "#bfe3cc", icon: "check_circle" },
            { id: "ALL", label: "全て", n: mtgCounts.ALL, fg: "var(--color-ink)", bg: "var(--color-surface)", bd: "var(--color-border-strong)", icon: "list" },
          ].map((m) => {
            const active = mtg === m.id;
            return (
              <button key={m.id} onClick={() => { setMtg(m.id as any); setShowAll(false); }}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 9, cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 700,
                  border: `1.5px solid ${active ? m.bd : "transparent"}`, background: active ? m.bg : "transparent", color: active ? m.fg : "var(--color-ink-3)" }}>
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>{m.icon}</span>
                {m.label}
                <span className="tnum" style={{ fontSize: 12, fontWeight: 800, padding: "1px 7px", borderRadius: 99, background: active ? "#ffffff80" : "var(--color-surface)", color: active ? m.fg : "var(--color-ink-4)" }}>{m.n}</span>
              </button>
            );
          })}
        </div>
        <span className="muted" style={{ fontSize: 11.5 }}>打合せ済にすると提案できます（行を選択 → 下部の「打合せ完了にする」で一括可）</span>
      </div>

      <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 12, padding: "12px 14px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 4, padding: 3, background: "var(--color-surface-inset)", borderRadius: 99 }}>
          {[{ id: "ALL", label: "全て" }, { id: "A", label: "A · 主要" }, { id: "B", label: "B · 拡大" }, { id: "C", label: "C · 維持" }].map((t) => (
            <button key={t.id} onClick={() => { setTier(t.id); setShowAll(false); }} style={{ padding: "6px 14px", borderRadius: 99, border: 0, background: tier === t.id ? "var(--color-surface)" : "transparent", color: tier === t.id ? "var(--color-ink)" : "var(--color-ink-3)", fontSize: 12, fontWeight: 600, fontFamily: "inherit", boxShadow: tier === t.id ? "0 1px 2px rgba(15,23,42,0.06)" : "none", cursor: "pointer" }}>
              {t.label} <span style={{ color: "var(--color-ink-4)", fontFamily: "var(--font-mono)", marginLeft: 4, fontWeight: 500 }} className="tnum">{counts[t.id as keyof typeof counts]}</span>
            </button>
          ))}
        </div>
        <div className="tbl-search" style={{ width: 240, flex: "0 0 240px" }}><Icons.search /><input placeholder="企業名・業種・担当者・企業IDで検索…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        {/* 登録状況フィルタ：企業マスタに手動登録済みか、案件からの自動集約のみか */}
        <div style={{ display: "flex", gap: 4, padding: 3, background: "var(--color-surface-inset)", borderRadius: 99 }}>
          {[
            { id: "ALL", label: "全て", n: merged.length },
            { id: "reg", label: "登録済み", n: merged.filter((c) => c.registered).length },
            { id: "unreg", label: "未登録", n: merged.filter((c) => !c.registered).length },
          ].map((m) => (
            <button key={m.id} onClick={() => { setRegF(m.id as any); setShowAll(false); }}
              title={m.id === "reg" ? "企業マスタに手動登録済み（連絡先・担当などの登録情報あり）" : m.id === "unreg" ? "案件データからの自動集約のみ（未登録）" : undefined}
              style={{ padding: "6px 12px", borderRadius: 99, border: 0, background: regF === m.id ? "var(--color-surface)" : "transparent", color: regF === m.id ? (m.id === "reg" ? "var(--color-brand-700)" : "var(--color-ink)") : "var(--color-ink-3)", fontSize: 12, fontWeight: 600, fontFamily: "inherit", boxShadow: regF === m.id ? "0 1px 2px rgba(15,23,42,0.06)" : "none", cursor: "pointer" }}>
              {m.label} <span className="tnum" style={{ color: "var(--color-ink-4)", fontFamily: "var(--font-mono)", marginLeft: 3, fontWeight: 500 }}>{m.n}</span>
            </button>
          ))}
        </div>
        {/* 種別フィルタ：案件提供／人材提供／両方 */}
        <div style={{ display: "flex", gap: 4, padding: 3, background: "var(--color-surface-inset)", borderRadius: 99 }}>
          {(() => {
            const jOnly = merged.filter((c) => (c.job_count ?? 0) > 0 && (c.candidate_count ?? 0) === 0).length;
            const cOnly = merged.filter((c) => (c.candidate_count ?? 0) > 0 && (c.job_count ?? 0) === 0).length;
            const both = merged.filter((c) => (c.job_count ?? 0) > 0 && (c.candidate_count ?? 0) > 0).length;
            const list = [
              { id: "ALL", label: "全種別", n: merged.length, tone: "var(--color-ink)" },
              { id: "job", label: "📋 案件提供", n: jOnly, tone: "#0b5cab" },
              { id: "cand", label: "👥 人材提供", n: cOnly, tone: "#5b21b6" },
              { id: "both", label: "🤝 両方", n: both, tone: "#9a5b1a" },
            ] as const;
            return list.map((m) => (
              <button key={m.id} onClick={() => { setKind(m.id as any); setShowAll(false); }}
                title={m.id === "job" ? "案件のみを出している企業（人材登録なし）" : m.id === "cand" ? "人材を提供している企業（案件なし）" : m.id === "both" ? "案件も人材も両方ある企業" : undefined}
                style={{ padding: "6px 12px", borderRadius: 99, border: 0, background: kind === m.id ? "var(--color-surface)" : "transparent", color: kind === m.id ? m.tone : "var(--color-ink-3)", fontSize: 12, fontWeight: 600, fontFamily: "inherit", boxShadow: kind === m.id ? "0 1px 2px rgba(15,23,42,0.06)" : "none", cursor: "pointer" }}>
                {m.label} <span className="tnum" style={{ color: "var(--color-ink-4)", fontFamily: "var(--font-mono)", marginLeft: 3, fontWeight: 500 }}>{m.n}</span>
              </button>
            ));
          })()}
        </div>
        {/* LINE 絞り込みトグル：ON で LINE でやり取りしている企業のみ表示 */}
        {(() => {
          const lineN = merged.filter((c) => isLineCompany(c.name)).length;
          return (
            <button onClick={() => { setLineOnly((v) => !v); setShowAll(false); }}
              title="LINE でやり取りしている企業（LINE 経由の提案あり）だけに絞り込む"
              style={{
                display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 12px", borderRadius: 99,
                border: `1px solid ${lineOnly ? "#06C755" : "var(--color-border-strong)"}`,
                background: lineOnly ? "#06C755" : "var(--color-surface)",
                color: lineOnly ? "#fff" : "#067647", fontSize: 12, fontWeight: 700, fontFamily: "inherit", cursor: "pointer",
              }}>
              <Icons.line size={14} />
              LINE企業 <span className="tnum" style={{ fontFamily: "var(--font-mono)", fontWeight: 500, opacity: 0.9 }}>{lineN}</span>
            </button>
          );
        })()}
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} style={{ fontFamily: "inherit", fontSize: 12, padding: "6px 12px", borderRadius: 99, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)" }}>
            <option value="target">狙い目スコア</option><option value="active_jobs">進行中案件</option><option value="job_count">案件数</option><option value="candidate_count">人材数</option><option value="avg_rate">平均単価</option><option value="last_job_at">最終更新</option>
          </select>
          {/* リスト / カード 切替（既定リスト） */}
          <div style={{ display: "flex", gap: 2, padding: 3, background: "var(--color-surface-inset)", borderRadius: 99 }}>
            <button onClick={() => setView("list")} title="リスト表示" style={{ padding: "5px 9px", borderRadius: 99, border: 0, cursor: "pointer", background: view === "list" ? "var(--color-surface)" : "transparent", color: view === "list" ? "var(--color-brand-700)" : "var(--color-ink-4)", boxShadow: view === "list" ? "0 1px 2px rgba(15,23,42,0.06)" : "none", display: "grid", placeItems: "center" }}>
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>view_list</span>
            </button>
            <button onClick={() => setView("card")} title="カード表示" style={{ padding: "5px 9px", borderRadius: 99, border: 0, cursor: "pointer", background: view === "card" ? "var(--color-surface)" : "transparent", color: view === "card" ? "var(--color-brand-700)" : "var(--color-ink-4)", boxShadow: view === "card" ? "0 1px 2px rgba(15,23,42,0.06)" : "none", display: "grid", placeItems: "center" }}>
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>grid_view</span>
            </button>
          </div>
          <button className="btn btn-xs" onClick={() => { setPasteOpen(true); setPasteMsg(null); }} title="企業名を貼り付けて一括で『打合せ済み（承認）』登録">
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>playlist_add_check</span><span>一括で打合せ済み登録</span>
          </button>
          <button className="btn brand btn-xs" onClick={() => setModal("new")}><Icons.plus /><span>新規登録</span></button>
        </div>
      </div>

      {/* 企業名を貼り付けて一括で「打合せ済み（承認）」登録するモーダル。 */}
      {pasteOpen && (
        <div onClick={() => !pasteBusy && setPasteOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 1100, background: "rgba(15,36,64,.5)", display: "grid", placeItems: "center", padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "min(560px, 96vw)", maxHeight: "90vh", overflowY: "auto", padding: 20 }}>
            <h3 style={{ margin: "0 0 6px", fontSize: 16, fontWeight: 800 }}>企業を一括登録（打合せ済み・承認）</h3>
            <p style={{ fontSize: 12.5, color: "var(--color-ink-3)", lineHeight: 1.7, margin: "0 0 12px" }}>
              企業名を<b>1行に1社</b>（カンマ・読点区切りも可）で貼り付けてください。
              既存企業は打合せ済みに更新、未登録の企業は<b>新規作成して打合せ済み（承認）</b>にします。
            </p>
            <textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)} rows={10} disabled={pasteBusy}
              placeholder={"株式会社ABC\n日本通信技術株式会社\n…"}
              style={{ width: "100%", fontFamily: "var(--font-sans)", fontSize: 13, lineHeight: 1.7, padding: 12, border: "1px solid var(--color-border-strong)", borderRadius: 10, resize: "vertical", background: "var(--color-surface)", boxSizing: "border-box" }} />
            <div style={{ fontSize: 11.5, color: "var(--color-ink-4)", marginTop: 4 }}>
              {pasteText.split(/\r?\n|,|、|\t/).map((s) => s.trim()).filter(Boolean).length} 社を認識
            </div>
            {pasteMsg && <div style={{ fontSize: 12.5, marginTop: 10, color: pasteMsg.ok ? "#067647" : "var(--color-danger)" }}>{pasteMsg.text}</div>}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
              <button type="button" className="btn ghost btn-xs" onClick={() => setPasteOpen(false)} disabled={pasteBusy}>閉じる</button>
              <button type="button" className="btn brand btn-xs" onClick={() => submitPaste(true)} disabled={pasteBusy}>
                {pasteBusy ? "登録中…" : "打合せ済み（承認）で一括登録"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── リスト表示（既定） ── */}
      {view === "list" && (
        filtered.length === 0 ? (
          <div className="card" style={{ textAlign: "center", color: "var(--color-ink-4)", padding: 40 }}>該当する企業がありません。</div>
        ) : (
          <div className="card flush" style={{ overflowX: "auto" }}>
            <table className="tbl" style={{ minWidth: 760 }}>
              <thead>
                <tr style={{ fontSize: 11, color: "var(--color-ink-4)" }}>
                  <th style={{ width: 36, textAlign: "center" }}>
                    <input type="checkbox" aria-label="表示中をすべて選択"
                      checked={visible.length > 0 && visible.every((c) => selected.has(c.name))}
                      onChange={(e) => {
                        const all = e.target.checked;
                        setSelected((prev) => { const next = new Set(prev); for (const c of visible) all ? next.add(c.name) : next.delete(c.name); return next; });
                      }} />
                  </th>
                  <th style={{ textAlign: "left" }}>企業名</th>
                  <th style={{ textAlign: "left", width: 96 }}>打合せ</th>
                  <th style={{ textAlign: "left", width: 64 }}>ティア</th>
                  <th style={{ textAlign: "left", width: 96 }} title="案件を出す企業／人材を提供する企業／両方">種別</th>
                  <th className="num" style={{ width: 64 }} title="この企業の案件件数（累計）">案件</th>
                  <th className="num" style={{ width: 64 }} title="この企業に所属する人材の登録数">人材</th>
                  <th className="num" style={{ width: 72 }} title="進行中の案件件数">進行中</th>
                  <th className="num" style={{ width: 80 }}>平均単価</th>
                  <th className="num" style={{ width: 60 }}>稼働</th>
                  <th className="num" style={{ width: 60 }}>失注</th>
                  <th className="num" style={{ width: 64 }}>狙い目</th>
                  <th style={{ textAlign: "left", width: 96 }}>最終案件</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((c) => {
                  const ts = tierStyle(c.tier); const done = isMeetingDone(c); const manual = !!c.reg?.meeting_done;
                  const isSel = selected.has(c.name);
                  return (
                    <tr key={c.name}
                      onClick={(e) => { if ((e.target as HTMLElement).closest("a,button,input,select,textarea,label")) return; setModal(c); }}
                      style={{ cursor: "pointer", background: isSel ? "var(--color-brand-25)" : undefined }}>
                      <td style={{ textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={isSel} onChange={() => toggleSel(c.name)} aria-label={`${c.name} を選択`} />
                      </td>
                      <td>
                        <div style={{ fontWeight: 700, color: "var(--color-ink)", display: "flex", alignItems: "center", gap: 6 }}>
                          <span>{c.name}</span>
                          {/* #293：企業ID（company_no）。提案管理の自社担当連携の確認用。 */}
                          {c.reg?.company_no != null && (
                            <span className="mono" title="企業ID" style={{ fontSize: 9.5, fontWeight: 600, color: "var(--color-ink-5)" }}>{companyIdLabel(c.reg.company_no)}</span>
                          )}
                          {/* LINE でやり取りしている企業は公式 LINE マークで識別 */}
                          {isLineCompany(c.name) && (
                            <span title="LINE でやり取りしている企業（LINE 経由の提案あり）" style={{ lineHeight: 0, flexShrink: 0 }}>
                              <Icons.line size={15} />
                            </span>
                          )}
                          {(() => { const rt = ratingOf(c.name); return rt ? <span title={`企業評価（失注時の案件★平均）${rt.avg} / ${rt.count}件`} style={{ flexShrink: 0 }}><StarsView value={rt.avg} size={12} showNumber count={rt.count} /></span> : null; })()}
                        </div>
                        <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 2 }}>
                          <span style={{ fontSize: 10.5, color: statusColor(c.status), fontWeight: 600 }}>● {c.status}</span>
                          {c.reg?.industry && <span className="muted" style={{ fontSize: 10.5 }}>{c.reg.industry}</span>}
                        </div>
                      </td>
                      <td>
                        {done
                          ? <span className="pill" style={{ fontSize: 10.5, background: "#e7f7ee", color: "#067647", borderColor: "transparent", fontWeight: 700 }}>✓ 済{manual && (c.meeting_count ?? 0) === 0 ? "（手動）" : ` ${c.meeting_count}`}</span>
                          : <span className="pill" style={{ fontSize: 10.5, background: "#fdecef", color: "#b42318", borderColor: "transparent", fontWeight: 700 }}>未</span>}
                      </td>
                      <td><span style={{ padding: "2px 8px", borderRadius: 6, fontSize: 10.5, fontWeight: 700, background: ts.bg, color: ts.color, border: `1px solid ${ts.border}` }}>{c.tier}</span></td>
                      <td>{(() => {
                        // 種別バッジ：案件提供／人材提供／両方／なし。アイコン色で一目で判別。
                        const hasJ = (c.job_count ?? 0) > 0;
                        const hasC = (c.candidate_count ?? 0) > 0;
                        if (hasJ && hasC) return <span className="pill" style={{ fontSize: 10, fontWeight: 700, background: "#fff1e6", color: "#9a5b1a", border: "1px solid #fde9b0" }}>🤝 両方</span>;
                        if (hasJ) return <span className="pill" style={{ fontSize: 10, fontWeight: 700, background: "#eef6fd", color: "#0b5cab", border: "1px solid #cfe5f7" }}>📋 案件提供</span>;
                        if (hasC) return <span className="pill" style={{ fontSize: 10, fontWeight: 700, background: "#f3f0ff", color: "#5b21b6", border: "1px solid #ddd6fe" }}>👥 人材提供</span>;
                        return <span className="muted" style={{ fontSize: 10 }}>—</span>;
                      })()}</td>
                      <td className="num tnum" style={{ color: (c.job_count ?? 0) > 0 ? "#0b5cab" : "var(--color-ink-4)", fontWeight: (c.job_count ?? 0) > 0 ? 700 : 400 }}>{c.job_count ?? 0}</td>
                      <td className="num tnum" style={{ color: (c.candidate_count ?? 0) > 0 ? "#5b21b6" : "var(--color-ink-4)", fontWeight: (c.candidate_count ?? 0) > 0 ? 700 : 400 }}>{c.candidate_count ?? 0}</td>
                      <td className="num tnum" style={{ fontWeight: 700 }}>{c.active_jobs}</td>
                      <td className="num tnum">{c.avg_rate != null ? `¥${c.avg_rate}万` : "—"}</td>
                      <td className="num tnum" style={{ color: "#1aa260" }}>{c.won}</td>
                      <td className="num tnum" style={{ color: c.lost > 0 ? "#d23f57" : "var(--color-ink-3)" }}>{c.lost}</td>
                      <td className="num"><span className="display tnum" style={{ fontWeight: 800, color: scoreColor(c.score) }}>{c.score}</span></td>
                      <td className="mono" style={{ fontSize: 11, color: "var(--color-ink-4)" }}>{dateLabel(c.last_job_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* ── カード表示 ── */}
      <div style={{ display: view === "card" ? "grid" : "none", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16 }}>
        {filtered.length === 0 ? (
          <div className="card" style={{ gridColumn: "1 / -1", textAlign: "center", color: "var(--color-ink-4)", padding: 40 }}>該当する企業がありません。</div>
        ) : visible.map((c) => {
          const color = colorOf(c.name); const ts = tierStyle(c.tier);
          return (
            <button key={c.name} onClick={() => setModal(c)} className="card" style={{ textAlign: "left", cursor: "pointer", padding: 20, display: "flex", flexDirection: "column", gap: 14, borderRadius: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ display: "flex", gap: 12, alignItems: "center", minWidth: 0 }}>
                  <div style={{ width: 46, height: 46, borderRadius: 12, flex: "0 0 46px", background: `linear-gradient(135deg, ${color}, ${color}aa)`, color: "#fff", display: "grid", placeItems: "center", fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 15 }}>{initialsOf(c.name)}</div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 14.5, color: "var(--color-ink)", lineHeight: 1.3, display: "flex", alignItems: "center", gap: 6 }}>
                      <span>{c.name}</span>
                      {isLineCompany(c.name) && (
                        <span title="LINE でやり取りしている企業（LINE 経由の提案あり）" style={{ lineHeight: 0, flexShrink: 0 }}>
                          <Icons.line size={15} />
                        </span>
                      )}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 11, color: statusColor(c.status), fontWeight: 600 }}>● {c.status}</span>
                      {isMeetingDone(c)
                        ? <span className="pill" style={{ fontSize: 10, background: "#e7f7ee", color: "#067647", borderColor: "transparent", fontWeight: 700 }}>✓ 打合せ済</span>
                        : <span className="pill" style={{ fontSize: 10, background: "#fdecef", color: "#b42318", borderColor: "transparent", fontWeight: 700 }}>未打合せ</span>}
                      {c.action && <span className="pill" style={{ fontSize: 10, borderColor: "transparent", background: `${c.action.tone}1a`, color: c.action.tone, fontWeight: 700 }}>{c.action.label}</span>}
                      {c.reg?.industry && <span className="tag" style={{ fontSize: 10 }}>{c.reg.industry}</span>}
                      {c.focus_jobs > 0 && <span className="tag" style={{ fontSize: 10, color: "#e0567f" }}>♥ 注力{c.focus_jobs}</span>}
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, flexShrink: 0 }}>
                  <div title="狙い目スコア" style={{ width: 46, height: 46, borderRadius: 12, background: `${scoreColor(c.score)}1a`, color: scoreColor(c.score), display: "grid", placeItems: "center", lineHeight: 1 }}>
                    <span className="display tnum" style={{ fontSize: 17, fontWeight: 800 }}>{c.score}</span><span style={{ fontSize: 8, fontWeight: 700, letterSpacing: ".05em" }}>狙い目</span>
                  </div>
                  <span style={{ padding: "2px 8px", borderRadius: 6, fontSize: 10.5, fontWeight: 700, fontFamily: "var(--font-display)", background: ts.bg, color: ts.color, border: `1px solid ${ts.border}` }}>{c.tier}</span>
                </div>
              </div>
              {(c.last_sentiment || c.last_relation || c.meeting_count > 0) && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                  {(() => { const st = sentTone(c.last_sentiment); return st ? <span className="pill" style={{ fontSize: 10.5, background: `${st.c}1a`, color: st.c, borderColor: "transparent" }}>{st.t}</span> : null; })()}
                  {c.last_relation && <span className="tag" style={{ fontSize: 10.5 }}>{c.last_relation}</span>}
                  {c.meeting_count > 0 && <span className="muted" style={{ fontSize: 10.5 }}>打合せ{c.meeting_count}回</span>}
                </div>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 1, background: "var(--color-border)", borderRadius: 10, overflow: "hidden", border: "1px solid var(--color-border)" }}>
                {[["進行中", `${c.active_jobs}`, "件", "var(--color-ink)"], ["平均単価", c.avg_rate != null ? `¥${c.avg_rate}` : "—", c.avg_rate != null ? "万" : "", "var(--color-brand-700)"], ["稼働", `${c.won}`, "件", "#1aa260"], ["失注", `${c.lost}`, "件", c.lost > 0 ? "#d23f57" : "var(--color-ink-3)"]].map(([lbl, v, u, col], i) => (
                  <div key={i} style={{ background: "var(--color-surface)", padding: "9px 10px" }}>
                    <div style={{ fontSize: 9.5, color: "var(--color-ink-4)", letterSpacing: "0.04em", fontWeight: 600 }}>{lbl}</div>
                    <div className="display tnum" style={{ fontSize: 17, fontWeight: 700, color: col as string, marginTop: 2 }}>{v}{u && <span style={{ fontSize: 10, color: "var(--color-ink-4)", marginLeft: 1, fontWeight: 500 }}>{u}</span>}</div>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 10.5, color: "var(--color-ink-4)", fontFamily: "var(--font-mono)" }}>最終案件 {dateLabel(c.last_job_at)}{c.registered ? " · 登録済" : ""}</div>
            </button>
          );
        })}
      </div>

      {filtered.length > PAGE && (
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 10, marginTop: 2 }}>
          <span className="muted" style={{ fontSize: 11.5 }}>{Math.min(visible.length, filtered.length)} / {filtered.length} 社</span>
          <button className="btn ghost btn-sm" onClick={() => setShowAll((v) => !v)}>
            {showAll ? "上位20社だけ表示" : `残り ${filtered.length - PAGE} 社を表示`}
          </button>
        </div>
      )}

      {modal && <CompanyModal data={modal === "new" ? null : modal} onClose={() => setModal(null)} />}

      {/* 選択中の一括操作バー：画面下部中央にフローティング（同じ .bulk-bar クラスを共有）。
          打合せ済の一括ON/OFFを下から即実行できる。結果メッセージはバー内に表示。 */}
      {selected.size > 0 && (
        <div className="bulk-bar">
          <span><b>{selected.size}</b> 社選択中</span>
          {bulkMsg && (
            <span style={{ fontSize: 11.5, fontWeight: 700, color: bulkMsg.ok ? "#a7f3d0" : "#fecaca" }}>
              {bulkMsg.ok ? "✓ " : "⚠ "}{bulkMsg.text}
            </span>
          )}
          <div style={{ display: "flex", gap: 8, marginLeft: "auto", flexWrap: "wrap" }}>
            <button type="button" className="btn" onClick={() => doBulkMeetingDone(true)} disabled={bulkBusy}
              style={{ background: "#1aa260", color: "#fff", border: 0 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 16, verticalAlign: "-3px" }}>check_circle</span>
              {bulkBusy ? " 保存中…" : " 打合せ完了にする"}
            </button>
            <button type="button" className="btn ghost" onClick={() => doBulkMeetingDone(false)} disabled={bulkBusy}>打合せ完了を解除</button>
            <button type="button" className="btn ghost" onClick={clearSel} disabled={bulkBusy}>選択解除</button>
          </div>
        </div>
      )}
    </>
  );
}

// ---- 詳細/編集/新規 モーダル ----
function CompanyModal({ data, onClose }: { data: Merged | null; onClose: () => void }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const reg = data?.reg;
  const [f, setF] = useState({
    name: data?.name ?? "", industry: reg?.industry ?? "", tier: (reg?.tier ?? data?.tier ?? "") as string, status: reg?.status ?? data?.status ?? "",
    owner_staff: reg?.owner_staff ?? "", contact_name: reg?.contact_name ?? "", contact_email: reg?.contact_email ?? "",
    phone: reg?.phone ?? "", website: reg?.website ?? "", address: reg?.address ?? "", note: reg?.note ?? "",
    // 対応特性タグ（属人知の資産化）
    contact_pref: reg?.contact_pref ?? "", response_speed: reg?.response_speed ?? "", decision_speed: reg?.decision_speed ?? "",
    caution_reason: reg?.caution_reason ?? "",
  });
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));
  const isNew = !data;
  // 取引注意（既存 caution 列。ON にするなら理由必須）。
  const [caution, setCaution] = useState<boolean>(reg?.caution === true);
  // WEB評判AI要約（実行状態・結果）。
  const [repBusy, setRepBusy] = useState(false);
  const [repMsg, setRepMsg] = useState<string | null>(null);
  const [repUrl, setRepUrl] = useState("");
  // 返ってきた要約はローカル state に保持して即時表示する。
  //   （モーダルはクリック時の client スナップショット data から描画されるため、
  //    router.refresh() では開いたままのモーダルの reg.web_reputation は更新されない。）
  const [repResult, setRepResult] = useState<{ summary: string; source?: string; at?: string } | null>(null);
  const runReputation = async () => {
    if (!data) return;
    setRepBusy(true); setRepMsg(null);
    try {
      const r = await summarizeCompanyReputation(data.name, repUrl.trim() || undefined);
      if (r.ok && r.summary) { setRepResult({ summary: r.summary, source: r.source, at: r.at }); router.refresh(); }
      else setRepMsg(r.error ?? "要約に失敗しました");
    } catch (e) { setRepMsg(e instanceof Error ? e.message : "要約に失敗しました"); }
    finally { setRepBusy(false); }
  };
  // 表示は「今回の要約結果」優先、無ければ保存済み（reg）を使う。
  const repView = repResult ?? (reg?.web_reputation ? { summary: reg.web_reputation, source: reg.web_reputation_source ?? undefined, at: reg.web_reputation_at ?? undefined } : null);

  // 打ち合わせ完了の手動フラグ。
  //   ・meeting_done=true → 常に「済」
  //   ・meeting_done=false & meeting_done_at あり → 明示的「未」（auto を上書き）
  //   ・どちらでもない → 打合せ記録(meeting_count>0)を fallback
  const autoDone = (data?.meeting_count ?? 0) > 0;
  const explicitOff = reg?.meeting_done === false && !!reg?.meeting_done_at;
  const initialChecked = reg?.meeting_done === true || (autoDone && !explicitOff);
  const [meetingDone, setMeetingDone] = useState<boolean>(initialChecked);
  const [mdBusy, setMdBusy] = useState(false);
  const [mdMsg, setMdMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [diag, setDiag] = useState<CompanyDiagnosis | null>(null);
  const [diagBusy, setDiagBusy] = useState(false);
  const runDiag = async () => {
    if (!data) return;
    setDiagBusy(true);
    try { setDiag(await diagnoseCompanyMeetingDone(data.name)); }
    catch (e) { setDiag({ ok: false, error: e instanceof Error ? e.message : String(e), hasServiceKey: false, hasMeetingDoneCol: null, hasMeetingDoneAtCol: null, input: data.name, inputNormalized: "", matches: [] }); }
    finally { setDiagBusy(false); }
  };
  const toggleMeetingDone = async (next: boolean) => {
    if (!data) return; // 新規作成時は保存後に
    setMeetingDone(next); setMdBusy(true); setMdMsg(null); setMsg(null);
    try {
      const res = await setCompanyMeetingDone(data.name, next);
      if (!res.ok) { setMeetingDone(!next); setMdMsg({ ok: false, text: res.error || "更新に失敗しました" }); }
      else { setMdMsg({ ok: true, text: next ? "打ち合わせ完了にしました" : "打ち合わせ完了を外しました" }); router.refresh(); }
    } catch (e) {
      setMeetingDone(!next);
      setMdMsg({ ok: false, text: e instanceof Error ? e.message : "更新に失敗しました" });
    } finally {
      setMdBusy(false);
    }
  };

  const save = async () => {
    if (!f.name.trim()) { setMsg("企業名を入力してください"); return; }
    if (caution && !f.caution_reason.trim()) { setMsg("取引注意にする場合は理由を入力してください"); return; }
    setSaving(true); setMsg(null);
    const res = await saveCompany({ ...f, caution });
    setSaving(false);
    if (res.ok) { router.refresh(); onClose(); } else setMsg(res.error || "保存に失敗しました");
  };
  const del = async () => {
    if (!data || !confirm(`「${data.name}」の登録情報を削除しますか？（案件由来の集計は残ります）`)) return;
    setSaving(true); const res = await deleteCompany(data.name); setSaving(false);
    if (res.ok) { router.refresh(); onClose(); } else setMsg(res.error || "削除に失敗しました");
  };

  const inp = { fontFamily: "inherit", fontSize: 13, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)", width: "100%" } as const;
  const L = ({ c }: { c: string }) => <div style={{ fontSize: 10.5, color: "var(--color-ink-4)", fontWeight: 600, marginBottom: 3 }}>{c}</div>;

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", display: "grid", placeItems: "center", zIndex: 300, padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "100%", maxWidth: 640, maxHeight: "88vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
            {isNew ? "企業を新規登録" : data!.name}
            {/* #293：企業ID。提案管理の自社担当がこのIDで連携されていることの確認用。 */}
            {!isNew && reg?.company_no != null && (
              <span className="mono" title="企業ID（提案管理の自社担当連携キー）" style={{ fontSize: 11, fontWeight: 700, color: "var(--color-ink-4)", padding: "1px 8px", borderRadius: 99, background: "var(--color-surface-inset)", border: "1px solid var(--color-border)" }}>
                {companyIdLabel(reg.company_no)}
              </span>
            )}
          </h3>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {data && <Link href={`/companies/${encodeURIComponent(data.name)}`} className="btn ghost btn-xs" style={{ textDecoration: "none" }}>詳細（案件・人材）→</Link>}
            <button className="btn ghost btn-xs" onClick={onClose}>閉じる</button>
          </div>
        </div>

        {/* 集計(分析データ) */}
        {data && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(90px,1fr))", gap: 1, background: "var(--color-border)", borderRadius: 10, overflow: "hidden", border: "1px solid var(--color-border)" }}>
            {[["全案件", data.job_count], ["進行中", data.active_jobs], ["注力", data.focus_jobs], ["提案", data.proposals_total], ["稼働", data.won], ["失注", data.lost], ["打合せ", data.meeting_count]].map(([l, v], i) => (
              <div key={i} style={{ background: "var(--color-surface)", padding: "8px 10px" }}>
                <div style={{ fontSize: 9.5, color: "var(--color-ink-4)", fontWeight: 600 }}>{l}</div>
                <div className="display tnum" style={{ fontSize: 16, fontWeight: 700 }}>{v as number}</div>
              </div>
            ))}
          </div>
        )}
        {data && (data.last_sentiment || data.last_relation) && (
          <div style={{ fontSize: 12, color: "var(--color-ink-3)" }}>温度感：{data.last_sentiment ?? "—"} / 関係性：{data.last_relation ?? "—"}（最終打合せ {dateLabel(data.last_meeting_at)}）</div>
        )}

        {/* 打ち合わせ完了の手動チェック（詳細から印を付ける）。
            autoDone（打合せ記録あり）でも明示的に「未」へ戻せるよう、チェックは常に操作可能。 */}
        {data && (
          <div>
            <label style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 10, cursor: mdBusy ? "default" : "pointer",
              background: meetingDone ? "#e7f7ee" : "var(--color-surface-inset)", border: `1px solid ${meetingDone ? "#bfe3cc" : "var(--color-border)"}` }}>
              <input type="checkbox" checked={meetingDone} disabled={mdBusy}
                onChange={(e) => toggleMeetingDone(e.target.checked)} style={{ width: 16, height: 16 }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: meetingDone ? "#067647" : "var(--color-ink-2)" }}>
                {meetingDone ? "✓ 打ち合わせ完了" : "打ち合わせ完了にする"}
              </span>
              <span className="muted" style={{ fontSize: 11, marginLeft: "auto" }}>
                {mdBusy ? "保存中…"
                  : autoDone && !meetingDone ? `打合せ記録${data.meeting_count}件あり（明示的に「未」に設定）`
                  : autoDone ? `打合せ記録${data.meeting_count}件あり`
                  : meetingDone ? "手動でチェック済"
                  : "顔合わせ・商談が済んだらチェック"}
              </span>
            </label>
            {mdMsg && (
              <div style={{ marginTop: 6, fontSize: 11.5, fontWeight: 600, color: mdMsg.ok ? "#067647" : "var(--color-danger)" }}>
                {mdMsg.ok ? "✓ " : "⚠ "}{mdMsg.text}
              </div>
            )}
            {/* 診断ボタン：実際のDB状態を見せて「保存できているのに表示に出ない/そもそも保存が効かない」を切り分ける */}
            <div style={{ marginTop: 6, display: "flex", gap: 8, alignItems: "center", fontSize: 11 }}>
              <button type="button" className="btn ghost btn-xs" onClick={runDiag} disabled={diagBusy}>
                {diagBusy ? "診断中…" : "🔍 DB状態を診断"}
              </button>
              <span className="muted">「済」にしたのに反映されないときは押してください</span>
            </div>
            {diag && (
              <div style={{ marginTop: 6, padding: "8px 10px", background: "var(--color-surface-inset)", borderRadius: 8, fontSize: 11.5, color: "var(--color-ink-2)", border: "1px solid var(--color-border)" }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>診断結果</div>
                {!diag.ok ? (
                  <div style={{ color: "var(--color-danger)", fontWeight: 600 }}>⚠ {diag.error ?? "不明なエラー"}</div>
                ) : (
                  <>
                    <div>SUPABASE_SERVICE_ROLE_KEY: <b style={{ color: diag.hasServiceKey ? "#067647" : "var(--color-danger)" }}>{diag.hasServiceKey ? "OK" : "未設定"}</b></div>
                    <div>meeting_done 列: <b style={{ color: diag.hasMeetingDoneCol ? "#067647" : "var(--color-danger)" }}>{diag.hasMeetingDoneCol ? "あり" : "なし"}</b> / meeting_done_at 列: <b style={{ color: diag.hasMeetingDoneAtCol ? "#067647" : "#b45309" }}>{diag.hasMeetingDoneAtCol ? "あり" : "なし"}</b></div>
                    <div style={{ marginTop: 4 }}>DBで一致する行: <b>{diag.matches.length}</b> 件</div>
                    {diag.matches.length === 0 && (
                      <div style={{ color: "var(--color-danger)", marginTop: 4 }}>⚠ 一致する行がDBにありません。チェックしても新規行が作られず保存が無効化されている可能性があります。</div>
                    )}
                    {diag.matches.map((m) => (
                      <div key={m.id} style={{ marginTop: 4, padding: "4px 8px", background: "var(--color-surface)", borderRadius: 6 }}>
                        <div>name: <span className="mono">"{m.name}"</span> {m.name !== diag.input && <span style={{ color: "#b45309", fontWeight: 700 }}>（入力と微差あり）</span>}</div>
                        <div>meeting_done: <b style={{ color: m.meeting_done ? "#067647" : "var(--color-danger)" }}>{String(m.meeting_done)}</b> / _at: <span className="mono">{m.meeting_done_at ?? "null"}</span></div>
                        <div className="mono" style={{ fontSize: 10, color: "var(--color-ink-4)", wordBreak: "break-all" }}>name(hex): {m.nameBytesHex}</div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* 紹介元ポータル：知り合い企業に会員登録なしの簡易ログイン(/ref)を発行し、
            この会社が紹介した人材（source_company で紐付け）×マッチ案件だけを見せる。 */}
        {data && <ReferralPortalSection company={data.name} />}

        {/* 編集フォーム */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div style={{ gridColumn: "1 / -1" }}><L c="企業名 *" /><input style={inp} value={f.name} onChange={(e) => set("name", e.target.value)} disabled={!isNew} /></div>
          <div><L c="業種" /><input style={inp} value={f.industry} onChange={(e) => set("industry", e.target.value)} placeholder="SaaS / 金融 など" /></div>
          <div><L c="自社担当" /><input style={inp} value={f.owner_staff} onChange={(e) => set("owner_staff", e.target.value)} /></div>
          <div><L c="ティア(上書き)" /><select style={inp as any} value={f.tier} onChange={(e) => set("tier", e.target.value)}><option value="">自動</option><option>A</option><option>B</option><option>C</option></select></div>
          <div><L c="ステータス(上書き)" /><select style={inp as any} value={f.status} onChange={(e) => set("status", e.target.value)}><option value="">自動</option><option>主要</option><option>拡大中</option><option>新規</option><option>休眠</option></select></div>
          <div><L c="窓口担当者" /><input style={inp} value={f.contact_name} onChange={(e) => set("contact_name", e.target.value)} /></div>
          <div><L c="窓口メール" /><input style={inp} type="email" value={f.contact_email} onChange={(e) => set("contact_email", e.target.value)} /></div>
          <div><L c="電話" /><input style={inp} value={f.phone} onChange={(e) => set("phone", e.target.value)} /></div>
          <div><L c="URL" /><input style={inp} value={f.website} onChange={(e) => set("website", e.target.value)} /></div>
          <div style={{ gridColumn: "1 / -1" }}><L c="所在地" /><input style={inp} value={f.address} onChange={(e) => set("address", e.target.value)} /></div>
          {/* 対応特性タグ：担当の勘（電話がつながらない/レスが遅い等）を構造化して全員で共有し、攻め先スコアにも反映。 */}
          <div><L c="連絡手段の当たり" /><select style={inp as any} value={f.contact_pref} onChange={(e) => set("contact_pref", e.target.value)}><option value="">未設定</option><option>電話OK</option><option>電話NG</option><option>メール推奨</option><option>LINE推奨</option><option>担当者次第</option></select></div>
          <div><L c="レス速度" /><select style={inp as any} value={f.response_speed} onChange={(e) => set("response_speed", e.target.value)}><option value="">未設定</option><option>速い</option><option>普通</option><option>遅い</option></select></div>
          <div><L c="決裁速度" /><select style={inp as any} value={f.decision_speed} onChange={(e) => set("decision_speed", e.target.value)}><option value="">未設定</option><option>速い</option><option>普通</option><option>遅い</option></select></div>
          <div style={{ gridColumn: "1 / -1" }}><L c="メモ" /><textarea style={{ ...inp, resize: "vertical" }} rows={3} value={f.note} onChange={(e) => set("note", e.target.value)} /></div>
        </div>

        {/* 取引注意（属人知の資産化）：ON にすると理由必須。攻め先スコアが下がり、一覧に⚠が出る。 */}
        <div style={{ border: `1px solid ${caution ? "#f7c5cf" : "var(--color-border)"}`, borderRadius: 10, padding: "10px 12px", background: caution ? "#fdecef" : "var(--color-surface)" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13, fontWeight: 700, color: caution ? "#b42318" : "var(--color-ink-2)" }}>
            <input type="checkbox" checked={caution} onChange={(e) => setCaution(e.target.checked)} style={{ width: 16, height: 16 }} />
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>{caution ? "warning" : "flag"}</span>
            取引注意にする
            <span className="muted" style={{ fontSize: 10.5, fontWeight: 500, marginLeft: "auto" }}>{reg?.caution_at ? `最終更新 ${dateLabel(reg.caution_at)}` : "「電話つながらない/合わない」等を根拠つきで共有"}</span>
          </label>
          {caution && (
            <textarea value={f.caution_reason} onChange={(e) => set("caution_reason", e.target.value)} rows={2} placeholder="理由（必須）：例）電話が全くつながらない／単価が毎回合わず稼働化ゼロ／連絡がルーズ 等"
              style={{ ...inp, marginTop: 8, resize: "vertical", border: `1px solid ${f.caution_reason.trim() ? "var(--color-border-strong)" : "var(--color-danger)"}` }} />
          )}
        </div>

        {/* WEB評判のAI要約（社内・参考情報＝要確認）。企業サイト or 口コミ/記事URLを要約して保存・再表示。 */}
        {data && (
          <div style={{ border: "1px solid var(--color-border)", borderRadius: 10, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span className="material-symbols-outlined" style={{ fontSize: 16, color: "var(--color-brand-700)" }}>travel_explore</span>
              <span style={{ fontSize: 12.5, fontWeight: 700 }}>WEB評判（AI要約）</span>
              <span className="muted" style={{ fontSize: 10.5 }}>参考情報・未検証（要確認）。URL未指定なら企業サイトを要約</span>
              <button type="button" className="btn brand btn-xs" style={{ marginLeft: "auto" }} disabled={repBusy} onClick={runReputation}>{repBusy ? "要約中…" : repView ? "再取得" : "AIで要約"}</button>
            </div>
            <input style={{ ...inp, fontSize: 12 }} value={repUrl} onChange={(e) => setRepUrl(e.target.value)} placeholder="口コミ/記事のURL（任意・https://…）。空欄なら企業サイトURLを使用" />
            {repMsg && <div style={{ fontSize: 11.5, color: "var(--color-danger)" }}>{repMsg}</div>}
            {repView && (
              <div style={{ fontSize: 12, background: "var(--color-surface-inset)", border: "1px solid var(--color-border)", borderRadius: 8, padding: "9px 11px", whiteSpace: "pre-wrap", lineHeight: 1.7 }}>
                {repView.summary}
                <div className="muted" style={{ fontSize: 10.5, marginTop: 6 }}>
                  {repView.source && <a href={repView.source} target="_blank" rel="noopener noreferrer" style={{ color: "var(--color-brand-700)" }}>情報源</a>}
                  {repView.at && <span style={{ marginLeft: 8 }}>取得 {dateLabel(repView.at)}</span>}
                </div>
              </div>
            )}
          </div>
        )}

        {msg && <div style={{ color: "var(--color-danger)", fontSize: 12.5 }}>{msg}</div>}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button className="btn brand" disabled={saving} onClick={save}>{saving ? "保存中…" : isNew ? "登録する" : "保存"}</button>
          {data && (
            <>
              <Link href={`/jobs?client=${encodeURIComponent(data.name)}`} className="btn ghost" style={{ textDecoration: "none" }}>案件を見る</Link>
              <Link href="/meetings" className="btn ghost" style={{ textDecoration: "none" }}>打合せ記録</Link>
              {data.registered && <button className="btn ghost" style={{ marginLeft: "auto", color: "var(--color-danger)" }} disabled={saving} onClick={del}>登録削除</button>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
