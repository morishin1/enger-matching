"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/toast";
import { Icons } from "./icons";
import { createMeeting, updateMeeting, deleteMeeting, setMeetingFollowDone } from "@/lib/actions";
import { MEETING_SENTIMENTS, MEETING_RELATIONS, MEETING_OWNERS, MEETING_COMPETITORS, MEETING_TAGS, MEETING_HITS, MEETING_MISSES, MEETING_NEEDS, MEETING_NEXT_ACTIONS } from "@/lib/proposal-constants";

const TODAY = new Date().toISOString().slice(0, 10);
/** 要フォロー：未完了 かつ（期限到来 or ネガティブ反応）。 */
function needsFollow(m: any): boolean {
  if (m.follow_done) return false;
  if (m.follow_up_date && String(m.follow_up_date).slice(0, 10) <= TODAY) return true;
  return (m.fb_sentiment ?? "").includes("ネガ");
}

const SENT_TONE: Record<string, string> = { "👍ポジティブ": "#1aa260", "😐中立": "#6b7280", "👎ネガティブ": "#d23f57", "⚠️競合比較": "#d98a2b" };
const dateLabel = (d: string | null) => { if (!d) return "—"; const t = new Date(d); return isNaN(t.getTime()) ? "—" : `${t.getFullYear()}/${t.getMonth() + 1}/${t.getDate()}`; };

const empty = {
  company_name: "", meeting_date: "", meeting_time: "", their_contact: "", our_owner: "", new_or_existing: "新規",
  relation_status: "🆕新規", fb_sentiment: "😐中立", ai_summary: "", enger_fb: "", hit_points: "",
  miss_points: "", needs: "", strategy: "", next_action_us: "", next_action_them: "",
  competitors: [] as string[], competitor_detail: "", tags: [] as string[], transcript_url: "", publishable: "配信可能", follow_up_date: "",
};

function Chips({ all, sel, onToggle }: { all: string[]; sel: string[]; onToggle: (v: string) => void }) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {all.map((o) => {
        const on = sel.includes(o);
        return <button key={o} type="button" onClick={() => onToggle(o)} className="tag" style={{ cursor: "pointer", fontSize: 11, background: on ? "var(--color-brand-600)" : "var(--color-surface-inset)", color: on ? "#fff" : "var(--color-ink-3)", border: 0 }}>{o}</button>;
      })}
    </div>
  );
}

const SEP = " / ";
/** テキスト列をタップ選択（プリセットを " / " 連結で保存）。AIを使わず素早く入力。 */
function TextChips({ presets, value, onChange, color = "var(--color-brand-600)" }: { presets: string[]; value: string; onChange: (v: string) => void; color?: string }) {
  const tokens = (value || "").split(SEP).map((s) => s.trim()).filter(Boolean);
  const toggle = (p: string) => {
    const next = tokens.includes(p) ? tokens.filter((t) => t !== p) : [...tokens, p];
    onChange(next.join(SEP));
  };
  // プリセット外（AIや手入力で入った値）も表示
  const extras = tokens.filter((t) => !presets.includes(t));
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {presets.map((o) => {
        const on = tokens.includes(o);
        return <button key={o} type="button" onClick={() => toggle(o)} className="tag" style={{ cursor: "pointer", fontSize: 11, background: on ? color : "var(--color-surface-inset)", color: on ? "#fff" : "var(--color-ink-3)", border: 0 }}>{o}</button>;
      })}
      {extras.map((o) => <button key={o} type="button" onClick={() => toggle(o)} className="tag" style={{ cursor: "pointer", fontSize: 11, background: color, color: "#fff", border: 0 }}>{o} ×</button>)}
    </div>
  );
}

/** 単一選択のタップボタン群（プルダウン代替で素早く選ぶ）。 */
function SegButtons({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {options.map((o) => {
        const on = value === o;
        return <button key={o} type="button" onClick={() => onChange(o)} style={{ cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: "inherit", padding: "6px 12px", borderRadius: 99, border: `1px solid ${on ? "var(--color-brand-600)" : "var(--color-border)"}`, background: on ? "var(--color-brand-50)" : "var(--color-surface)", color: on ? "var(--color-brand-700)" : "var(--color-ink-3)" }}>{o}</button>;
      })}
    </div>
  );
}

function MeetingForm({ companies, onDone, initial, editId, onDeleted }: { companies: string[]; onDone: () => void; initial?: Partial<typeof empty>; editId?: string | null; onDeleted?: () => void }) {
  const router = useRouter();
  const [f, setF] = useState({ ...empty, ...(initial ?? {}) });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [transcript, setTranscript] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [aiMsg, setAiMsg] = useState<string | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [aiDone, setAiDone] = useState(false);
  const set = (k: string, v: any) => setF((p) => ({ ...p, [k]: v }));
  const toggle = (k: "competitors" | "tags", v: string) => setF((p) => ({ ...p, [k]: p[k].includes(v) ? p[k].filter((x) => x !== v) : [...p[k], v] }));

  const analyze = async () => {
    if (!transcript.trim()) { setAiMsg("文字起こしを貼り付けてください"); return; }
    setAnalyzing(true); setAiMsg(null);
    try {
      const res = await fetch("/api/meeting-analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ transcript, company: f.company_name }) });
      const data = await res.json();
      if (!data.ok) { setAiMsg(data.error || "解析に失敗しました"); return; }
      const r = data.result;
      setF((p) => ({
        ...p,
        ai_summary: r.ai_summary || p.ai_summary,
        fb_sentiment: r.fb_sentiment || p.fb_sentiment,
        relation_status: r.relation_status || p.relation_status,
        new_or_existing: r.new_or_existing || p.new_or_existing,
        hit_points: r.hit_points || p.hit_points,
        miss_points: r.miss_points || p.miss_points,
        needs: r.needs || p.needs,
        strategy: r.strategy || p.strategy,
        next_action_us: r.next_action_us || p.next_action_us,
        next_action_them: r.next_action_them || p.next_action_them,
        competitor_detail: r.competitor_detail || p.competitor_detail,
        competitors: (r.competitors?.length ? r.competitors : p.competitors),
        tags: (r.tags?.length ? r.tags : p.tags),
      }));
      setAiMsg("AI解析を反映しました。下のプルダウンを確認して保存してください。");
      setAiDone(true);
    } catch (e) {
      setAiMsg(e instanceof Error ? e.message : "解析に失敗しました");
    } finally { setAnalyzing(false); }
  };

  const submit = async () => {
    if (!f.company_name.trim()) { setErr("相手企業を入力してください"); return; }
    setSaving(true); setErr(null);
    const res = editId ? await updateMeeting(editId, f) : await createMeeting(f);
    setSaving(false);
    if (res.ok) { router.refresh(); onDone(); } else setErr(res.error || "保存に失敗しました");
  };

  const inp = { fontFamily: "inherit", fontSize: 12.5, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)", width: "100%" } as const;
  const L = ({ children }: { children: React.ReactNode }) => <div style={{ fontSize: 10.5, color: "var(--color-ink-4)", fontWeight: 600, marginBottom: 3 }}>{children}</div>;

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* 基本（最小） */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10 }}>
        <div><L>相手企業 *</L><input style={inp} list="company-list" value={f.company_name} onChange={(e) => set("company_name", e.target.value)} placeholder="企業名" /><datalist id="company-list">{companies.map((c) => <option key={c} value={c} />)}</datalist></div>
        <div><L>打ち合わせ日</L><input style={inp} type="date" value={f.meeting_date} onChange={(e) => set("meeting_date", e.target.value)} /></div>
        <div><L>時刻</L><input style={inp} type="time" value={(f as any).meeting_time ?? ""} onChange={(e) => set("meeting_time" as any, e.target.value)} /></div>
        <div><L>自社担当者</L><select style={inp} value={f.our_owner} onChange={(e) => set("our_owner", e.target.value)}><option value="">—</option>{MEETING_OWNERS.map((o) => <option key={o}>{o}</option>)}</select></div>
      </div>

      {/* タップで素早く入力（AI不使用） */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
        <div><L>温度感（FB感情）</L><SegButtons options={MEETING_SENTIMENTS} value={f.fb_sentiment} onChange={(v) => set("fb_sentiment", v)} /></div>
        <div><L>関係性</L><SegButtons options={MEETING_RELATIONS} value={f.relation_status} onChange={(v) => set("relation_status", v)} /></div>
        <div><L>新規 / 既存</L><SegButtons options={["新規", "既存"]} value={f.new_or_existing} onChange={(v) => set("new_or_existing", v)} /></div>
        <div><L>次回フォロー予定日</L><input style={{ ...inp, maxWidth: 200 }} type="date" value={f.follow_up_date} onChange={(e) => set("follow_up_date", e.target.value)} /></div>
      </div>

      <div><L>刺さった点（タップ）</L><TextChips presets={MEETING_HITS} value={f.hit_points} onChange={(v) => set("hit_points", v)} /></div>
      <div><L>響かなかった点（タップ）</L><TextChips presets={MEETING_MISSES} value={f.miss_points} onChange={(v) => set("miss_points", v)} color="#d23f57" /></div>
      <div><L>顧客の課題・ニーズ（タップ）</L><TextChips presets={MEETING_NEEDS} value={f.needs} onChange={(v) => set("needs", v)} /></div>
      <div><L>競合・他社言及（タップ）</L><Chips all={MEETING_COMPETITORS} sel={f.competitors} onToggle={(v) => toggle("competitors", v)} /></div>
      <div><L>次回アクション・自社（タップ）</L><TextChips presets={MEETING_NEXT_ACTIONS} value={f.next_action_us} onChange={(v) => set("next_action_us", v)} color="#0b5cab" /></div>
      <div><L>横串タグ（タップ）</L><Chips all={MEETING_TAGS} sel={f.tags} onToggle={(v) => toggle("tags", v)} /></div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div><L>一言メモ（任意）</L><input style={inp} value={f.ai_summary} onChange={(e) => set("ai_summary", e.target.value)} placeholder="補足があれば一言だけ" /></div>
        <div><L>Meetノート / Drive の共有URL（任意）</L><input style={inp} value={f.transcript_url} onChange={(e) => set("transcript_url", e.target.value)} placeholder="https://docs.google.com/..." /></div>
      </div>

      {/* （任意）AI補完 — コスト配慮で折りたたみ・通常は使わない */}
      <button type="button" onClick={() => setShowDetail((v) => !v)} style={{ alignSelf: "flex-start", border: 0, background: "transparent", color: "var(--color-ink-4)", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
        {showDetail ? "▾ 閉じる" : "▸ （任意）文字起こしからAIで補完 / 詳細項目"}
      </button>
      {showDetail && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, borderTop: "1px dashed var(--color-border)", paddingTop: 10 }}>
          <div style={{ border: "1px solid var(--color-border)", borderRadius: 10, padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <span style={{ fontSize: 12, color: "var(--color-ink-3)" }}>文字起こしを貼ると上の項目をAIが補完（任意・API使用）</span>
              <button type="button" className="btn ghost btn-xs" disabled={analyzing} onClick={analyze}>{analyzing ? "解析中…" : "✨ AIで補完"}</button>
            </div>
            <textarea style={{ ...inp, resize: "vertical" }} rows={3} value={transcript} onChange={(e) => setTranscript(e.target.value)} placeholder="必要なときだけ：Meet/Gemini の文字起こしを貼り付け…" />
            {aiMsg && <div style={{ fontSize: 11.5, color: aiDone ? "#067647" : "var(--color-ink-3)" }}>{aiMsg}</div>}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div><L>戦略的示唆</L><textarea style={{ ...inp, resize: "vertical" }} rows={2} value={f.strategy} onChange={(e) => set("strategy", e.target.value)} /></div>
            <div><L>次回アクション(相手)</L><input style={inp} value={f.next_action_them} onChange={(e) => set("next_action_them", e.target.value)} /></div>
            <div><L>エンジャーへのFB</L><textarea style={{ ...inp, resize: "vertical" }} rows={2} value={f.enger_fb} onChange={(e) => set("enger_fb", e.target.value)} /></div>
            <div><L>相手側担当者</L><input style={inp} value={f.their_contact} onChange={(e) => set("their_contact", e.target.value)} /></div>
            <div><L>競合言及の詳細</L><input style={inp} value={f.competitor_detail} onChange={(e) => set("competitor_detail", e.target.value)} /></div>
            <div><L>配信可否</L><select style={inp} value={f.publishable} onChange={(e) => set("publishable", e.target.value)}><option>配信可能</option><option>配信不可</option></select></div>
          </div>
        </div>
      )}

      {err && <div style={{ color: "var(--color-danger)", fontSize: 12 }}>{err}</div>}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" className="btn brand" disabled={saving} onClick={submit}>{saving ? "保存中…" : (editId ? "更新を保存" : "記録を保存")}</button>
        <button type="button" className="btn ghost" onClick={onDone}>キャンセル</button>
        {editId && (
          <button type="button" className="btn ghost" disabled={saving}
            onClick={async () => {
              if (!confirm("この打ち合わせ記録を削除しますか？ 元に戻せません。")) return;
              setSaving(true);
              const res = await deleteMeeting(editId);
              setSaving(false);
              if (res.ok) { router.refresh(); onDeleted?.(); onDone(); } else setErr(res.error || "削除に失敗しました");
            }}
            style={{ marginLeft: "auto", color: "var(--color-danger)", borderColor: "var(--color-danger)" }}>
            🗑 削除
          </button>
        )}
      </div>
    </div>
  );
}

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
const ymd = (y: number, mo: number, d: number) => `${y}-${String(mo + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** 月カレンダー：打ち合わせ記録（meeting_date）・面談予定（提案）・フォロー予定（follow_up_date）を可視化。 */
function MonthCalendar({ meetings, interviews, onPick, onInterview, onPickDay }: { meetings: any[]; interviews: any[]; onPick: (company: string) => void; onInterview: (iv: any) => void; onPickDay?: (dateStr: string) => void }) {
  const [cursor, setCursor] = useState(() => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d; });
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const todayStr = new Date().toISOString().slice(0, 10);

  const byDay = useMemo(() => {
    const m: Record<string, any[]> = {};
    for (const mt of meetings) { const d = mt.meeting_date ? String(mt.meeting_date).slice(0, 10) : null; if (!d) continue; (m[d] ||= []).push(mt); }
    return m;
  }, [meetings]);
  const ivByDay = useMemo(() => {
    const m: Record<string, any[]> = {};
    for (const iv of interviews) { const d = iv.meeting_date ? String(iv.meeting_date).slice(0, 10) : null; if (!d) continue; (m[d] ||= []).push(iv); }
    return m;
  }, [interviews]);
  const followByDay = useMemo(() => {
    const m: Record<string, number> = {};
    for (const mt of meetings) { if (mt.follow_done) continue; const d = mt.follow_up_date ? String(mt.follow_up_date).slice(0, 10) : null; if (!d) continue; m[d] = (m[d] ?? 0) + 1; }
    return m;
  }, [meetings]);
  const monthCount = useMemo(() => Object.keys(byDay).filter((d) => d.startsWith(ymd(year, month, 1).slice(0, 7))).reduce((a, d) => a + byDay[d].length, 0), [byDay, year, month]);

  const startDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const navBtn = { padding: "5px 11px", borderRadius: 8, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink-2)", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" } as const;

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button style={navBtn} onClick={() => setCursor(new Date(year, month - 1, 1))}>‹ 前月</button>
        <div style={{ fontSize: 16, fontWeight: 800, minWidth: 130, textAlign: "center" }}>{year}年 {month + 1}月</div>
        <button style={navBtn} onClick={() => setCursor(new Date(year, month + 1, 1))}>翌月 ›</button>
        <button style={{ ...navBtn, fontWeight: 600 }} onClick={() => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); setCursor(d); }}>今月</button>
        <span className="muted" style={{ fontSize: 12, marginLeft: "auto" }}>この月の打ち合わせ {monthCount} 件</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 1, background: "var(--color-border)", border: "1px solid var(--color-border)", borderRadius: 10, overflow: "hidden" }}>
        {WEEKDAYS.map((w, i) => (
          <div key={w} style={{ background: "var(--color-surface-inset)", textAlign: "center", padding: "6px 0", fontSize: 11.5, fontWeight: 700, color: i === 0 ? "#d23f57" : i === 6 ? "#0b5cab" : "var(--color-ink-3)" }}>{w}</div>
        ))}
        {cells.map((d, idx) => {
          if (d == null) return <div key={`e${idx}`} style={{ background: "var(--color-surface-soft)", minHeight: 92 }} />;
          const key = ymd(year, month, d);
          const items = byDay[key] ?? [];
          const ivs = ivByDay[key] ?? [];
          const follows = followByDay[key] ?? 0;
          const isToday = key === todayStr;
          const dow = (startDow + d - 1) % 7;
          return (
            <div key={key} onClick={(ev) => { if (onPickDay && !(ev.target as HTMLElement).closest("button,a")) onPickDay(key); }}
              style={{ background: "var(--color-surface)", minHeight: 92, padding: 5, display: "flex", flexDirection: "column", gap: 3, outline: isToday ? "2px solid var(--color-brand-500,#0b5cab)" : "none", outlineOffset: -2, cursor: onPickDay ? "pointer" : "default" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: isToday ? "var(--color-brand-700,#0b5cab)" : dow === 0 ? "#d23f57" : dow === 6 ? "#0b5cab" : "var(--color-ink-3)" }}>{d}</span>
                {follows > 0 && <span title={`フォロー予定 ${follows}件`} style={{ fontSize: 9.5 }}>🔔{follows}</span>}
              </div>
              {/* 面談予定（提案）: クリックで記録作成（企業名・日付・候補名をプリフィル） */}
              {ivs.slice(0, 2).map((iv, i) => (
                <button key={`iv${i}`} type="button" onClick={() => onInterview(iv)} title={`面談予定：${iv.company_name ?? iv.company ?? ""}${iv.candidate_name ? ` / ${iv.candidate_name}` : ""}${iv.meeting_status ? `（${iv.meeting_status}）` : ""}　クリックで記録作成`}
                  style={{ textAlign: "left", border: "1px dashed #7c5cff", background: "#7c5cff14", color: "#5b3fd1", borderRadius: 4, padding: "2px 5px", fontSize: 10, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  🗣 {iv.company ?? iv.company_name ?? "—"}
                </button>
              ))}
              {ivs.length > 2 && <span style={{ fontSize: 10, color: "#5b3fd1" }}>面談＋{ivs.length - 2}</span>}
              {items.slice(0, 3).map((m, i) => {
                const tone = SENT_TONE[m.fb_sentiment] ?? "#6b7280";
                return (
                  <button key={i} type="button" onClick={() => onPick(m.company_name ?? "")} title={`${m.company_name ?? ""}${m.our_owner ? ` / ${m.our_owner}` : ""}`}
                    style={{ textAlign: "left", border: 0, borderLeft: `3px solid ${tone}`, background: `${tone}14`, color: "var(--color-ink-2)", borderRadius: 4, padding: "2px 5px", fontSize: 10.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {m.company_name ?? "—"}
                  </button>
                );
              })}
              {items.length > 3 && <span style={{ fontSize: 10, color: "var(--color-ink-4)" }}>＋{items.length - 3}件</span>}
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 11, color: "var(--color-ink-4)" }}>
        <span>● 色＝FB感情（記録）</span><span style={{ color: "#5b3fd1" }}>🗣 破線＝面談予定（提案）・クリックで記録作成</span><span>🔔＝フォロー予定（未完了）</span>
      </div>
    </div>
  );
}

export function MeetingsClient({ meetings, companies, interviews = [] }: { meetings: any[]; companies: string[]; interviews?: any[] }) {
  const router = useRouter();
  const [show, setShow] = useState(false);
  const [formInitial, setFormInitial] = useState<Partial<typeof empty> | undefined>(undefined);
  const [editId, setEditId] = useState<string | null>(null);
  // カレンダー日付クリック時のドロワー（その日の打合せ一覧）
  const [dayDrawer, setDayDrawer] = useState<string | null>(null);
  const openEdit = (m: any) => {
    setEditId(m.id);
    setFormInitial({
      company_name: m.company_name ?? "", meeting_date: m.meeting_date ? String(m.meeting_date).slice(0, 10) : "", meeting_time: m.meeting_time ? String(m.meeting_time).slice(0, 5) : "",
      their_contact: m.their_contact ?? "", our_owner: m.our_owner ?? "", new_or_existing: m.new_or_existing ?? "新規",
      relation_status: m.relation_status ?? "", fb_sentiment: m.fb_sentiment ?? "", ai_summary: m.ai_summary ?? "",
      enger_fb: m.enger_fb ?? "", hit_points: m.hit_points ?? "", miss_points: m.miss_points ?? "",
      needs: m.needs ?? "", strategy: m.strategy ?? "", next_action_us: m.next_action_us ?? "", next_action_them: m.next_action_them ?? "",
      competitors: m.competitors ?? [], competitor_detail: m.competitor_detail ?? "", tags: m.tags ?? [],
      transcript_url: m.transcript_url ?? "", publishable: m.publishable ?? "", follow_up_date: m.follow_up_date ? String(m.follow_up_date).slice(0, 10) : "",
    });
    setShow(true);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const [view, setView] = useState<"calendar" | "cards">("calendar");

  // 面談予定（提案）をクリック → 記録フォームを企業名・日付・候補名でプリフィルして開く
  const openFromInterview = (iv: any) => {
    setFormInitial({
      company_name: iv.company ?? iv.company_name ?? "",
      meeting_date: iv.meeting_date ? String(iv.meeting_date).slice(0, 10) : "",
      our_owner: iv.closer ?? iv.proposer ?? "",
      ai_summary: `面談: ${iv.candidate_name ?? ""}${iv.c_init ? `（${iv.c_init}）` : ""}${iv.job_title ? ` / ${iv.job_title}` : ""}`.trim(),
    });
    setShow(true);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const [sent, setSent] = useState("");
  const [rel, setRel] = useState("");
  const [q, setQ] = useState("");
  const [onlyFollow, setOnlyFollow] = useState(false);

  const followCount = useMemo(() => meetings.filter(needsFollow).length, [meetings]);
  const filtered = useMemo(() => meetings.filter((m) =>
    (!sent || m.fb_sentiment === sent) && (!rel || m.relation_status === rel) &&
    (!onlyFollow || needsFollow(m)) &&
    (!q.trim() || (m.company_name ?? "").includes(q.trim()) || (m.title ?? "").includes(q.trim()))
  ), [meetings, sent, rel, q, onlyFollow]);

  const sel = { fontFamily: "inherit", fontSize: 12, padding: "6px 10px", borderRadius: 99, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)" } as const;
  const markDone = (id: string, done: boolean) => setMeetingFollowDone(id, done).then(() => router.refresh());

  return (
    <>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn brand" onClick={() => { setEditId(null); setFormInitial(undefined); setShow((v) => !v); }} title="打合せ記録を新規に追加">
          <Icons.plus /><span>{show ? "フォームを閉じる" : "新規記録"}</span>
        </button>
        <button onClick={() => setOnlyFollow((v) => !v)} style={{ padding: "6px 12px", borderRadius: 99, fontSize: 12, fontWeight: 700, fontFamily: "inherit", cursor: "pointer", border: `1px solid ${onlyFollow ? "#d98a2b" : "var(--color-border-strong)"}`, background: onlyFollow ? "#fff1e6" : "var(--color-surface)", color: onlyFollow ? "#b45309" : "var(--color-ink-3)" }}>🔔 要フォロー {followCount}</button>
        <div className="tbl-search" style={{ width: 220, flex: "0 0 220px" }}><Icons.search /><input placeholder="企業名で検索…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <select style={sel} value={sent} onChange={(e) => setSent(e.target.value)}><option value="">FB感情：すべて</option>{MEETING_SENTIMENTS.map((o) => <option key={o}>{o}</option>)}</select>
        <select style={sel} value={rel} onChange={(e) => setRel(e.target.value)}><option value="">関係性：すべて</option>{MEETING_RELATIONS.map((o) => <option key={o}>{o}</option>)}</select>
        <div style={{ display: "flex", gap: 4, padding: 3, background: "var(--color-surface-inset)", borderRadius: 99, marginLeft: "auto" }}>
          {([["calendar", "🗓 カレンダー"], ["cards", "🗂 カード"]] as const).map(([id, label]) => (
            <button key={id} onClick={() => setView(id)} style={{ padding: "6px 14px", borderRadius: 99, border: 0, fontSize: 12.5, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", background: view === id ? "var(--color-surface)" : "transparent", color: view === id ? "var(--color-ink)" : "var(--color-ink-3)", boxShadow: view === id ? "0 1px 2px rgba(15,23,42,0.06)" : "none" }}>{label}</button>
          ))}
        </div>
      </div>

      {show && <MeetingForm key={editId ?? JSON.stringify(formInitial ?? {})} companies={companies} initial={formInitial} editId={editId} onDone={() => { setShow(false); setFormInitial(undefined); setEditId(null); }} onDeleted={() => { /* refresh after deletion handled in form */ }} />}

      {view === "calendar" ? (
        <MonthCalendar meetings={filtered} interviews={interviews} onPick={(c) => { if (c) { setQ(c); setView("cards"); } }} onInterview={openFromInterview} onPickDay={(ds) => setDayDrawer(ds)} />
      ) : filtered.length === 0 ? (
        <div className="card" style={{ textAlign: "center", color: "var(--color-ink-4)", padding: 40 }}>記録がありません。上の「新規記録」ボタンから追加してください。</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 16 }}>
          {filtered.map((m) => {
            const tone = SENT_TONE[m.fb_sentiment] ?? "#6b7280";
            return (
              <div key={m.id} className="card" style={{ display: "flex", flexDirection: "column", gap: 10, borderTop: `3px solid ${tone}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{m.company_name ?? "—"}</div>
                    <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{dateLabel(m.meeting_date)}{m.meeting_time ? ` ${String(m.meeting_time).slice(0, 5)}` : ""} · {m.our_owner ?? "—"}{m.their_contact ? ` / 先方 ${m.their_contact}` : ""}</div>
                  </div>
                  <div style={{ display: "flex", gap: 4, flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    {m.fb_sentiment && <span className="pill" style={{ fontSize: 10.5, background: `${tone}1a`, color: tone, borderColor: "transparent" }}>{m.fb_sentiment}</span>}
                    {m.relation_status && <span className="tag" style={{ fontSize: 10.5 }}>{m.relation_status}</span>}
                  </div>
                </div>
                {m.ai_summary && <div style={{ fontSize: 12, color: "var(--color-ink-2)", lineHeight: 1.6 }}>{m.ai_summary}</div>}
                {m.hit_points && <div style={{ fontSize: 11.5, color: "var(--color-ink-2)" }}>✅ 刺さった：{m.hit_points}</div>}
                {m.miss_points && <div style={{ fontSize: 11.5, color: "var(--color-ink-3)" }}>⚠️ 響かず：{m.miss_points}</div>}
                {m.enger_fb && <div style={{ fontSize: 11.5, color: "var(--color-brand-700)" }}>📣 ENGER FB：{m.enger_fb}</div>}
                {m.next_action_us && <div style={{ fontSize: 11.5, color: "var(--color-ink-2)" }}>▶ 次(自社)：{m.next_action_us}</div>}
                {(m.follow_up_date || needsFollow(m)) && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    {m.follow_up_date && <span className="pill" style={{ fontSize: 10.5, borderColor: "transparent", background: needsFollow(m) ? "#fff1e6" : "var(--color-surface-inset)", color: needsFollow(m) ? "#b45309" : "var(--color-ink-3)" }}>🔔 フォロー {dateLabel(m.follow_up_date)}</span>}
                    {m.follow_done
                      ? <span style={{ fontSize: 10.5, color: "#1aa260" }}>✓ 完了</span>
                      : <button type="button" className="btn ghost btn-xs" onClick={() => markDone(m.id, true)}>フォロー完了</button>}
                  </div>
                )}
                {(m.competitors?.length > 0 || m.tags?.length > 0) && (
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {(m.competitors ?? []).filter((c: string) => c !== "言及なし").map((c: string) => <span key={c} className="tag" style={{ fontSize: 10, color: "#d23f57" }}>vs {c}</span>)}
                    {(m.tags ?? []).map((t: string) => <span key={t} className="tag" style={{ fontSize: 10 }}>#{t}</span>)}
                  </div>
                )}
                {m.transcript_url && <a href={m.transcript_url} target="_blank" rel="noreferrer" className="btn ghost btn-xs" style={{ alignSelf: "flex-start", textDecoration: "none" }}>📄 元文字起こし</a>}
                {/* 編集・削除 */}
                <div style={{ display: "flex", gap: 6, marginTop: "auto", borderTop: "1px dashed var(--color-border)", paddingTop: 8 }}>
                  <button type="button" className="btn ghost btn-xs" onClick={() => openEdit(m)}>✎ 編集</button>
                  <button type="button" className="btn ghost btn-xs" style={{ color: "var(--color-danger)" }}
                    onClick={async () => { if (!confirm(`「${m.company_name ?? "この記録"}」を削除しますか？元に戻せません。`)) return; const r = await deleteMeeting(m.id); if (r.ok) router.refresh(); else toast(r.error ?? "削除に失敗しました", "error"); }}>
                    🗑 削除
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* カレンダーから日付クリックで開くドロワー（その日の打合せ一覧） */}
      {dayDrawer && (() => {
        const dayMeetings = filtered.filter((m) => m.meeting_date && String(m.meeting_date).slice(0, 10) === dayDrawer)
          .sort((a, b) => String(a.meeting_time ?? "").localeCompare(String(b.meeting_time ?? "")));
        return (
          <div onClick={() => setDayDrawer(null)} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.4)", zIndex: 300 }}>
            <div onClick={(e) => e.stopPropagation()} className="card" role="dialog" aria-modal="true"
              style={{ position: "absolute", top: 0, right: 0, height: "100%", width: "min(560px, 92vw)", overflowY: "auto", display: "flex", flexDirection: "column", gap: 12, borderRadius: 0, boxShadow: "-12px 0 32px rgba(15,23,42,.18)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div className="meta" style={{ fontSize: 10, letterSpacing: ".08em", color: "var(--color-ink-4)", fontWeight: 700 }}>MEETINGS · 日付詳細</div>
                  <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>{dayDrawer}</h3>
                </div>
                <button className="btn ghost btn-xs" onClick={() => setDayDrawer(null)}>閉じる</button>
              </div>
              <button className="btn brand btn-xs" onClick={() => { setDayDrawer(null); setEditId(null); setFormInitial({ ...empty, meeting_date: dayDrawer } as any); setShow(true); if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" }); }}>
                ＋ この日に新規記録
              </button>
              {dayMeetings.length === 0 ? <div className="muted" style={{ fontSize: 12 }}>この日の打合せはありません。</div> : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {dayMeetings.map((m) => (
                    <div key={m.id} className="card" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 6 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                        <div style={{ fontWeight: 700, fontSize: 13 }}>{m.meeting_time ? `${String(m.meeting_time).slice(0, 5)} · ` : ""}{m.company_name ?? "—"}</div>
                        <div style={{ display: "flex", gap: 4 }}>
                          <button className="btn ghost btn-xs" onClick={() => { setDayDrawer(null); openEdit(m); }}>✎</button>
                          <button className="btn ghost btn-xs" style={{ color: "var(--color-danger)" }}
                            onClick={async () => { if (!confirm("削除しますか？")) return; const r = await deleteMeeting(m.id); if (r.ok) router.refresh(); }}>🗑</button>
                        </div>
                      </div>
                      <div className="muted" style={{ fontSize: 11 }}>{m.our_owner ?? "—"}{m.their_contact ? ` / 先方 ${m.their_contact}` : ""}</div>
                      {m.fb_sentiment && <span className="pill" style={{ alignSelf: "flex-start", fontSize: 10.5 }}>{m.fb_sentiment}</span>}
                      {m.ai_summary && <div style={{ fontSize: 12, color: "var(--color-ink-2)" }}>{m.ai_summary}</div>}
                      {m.next_action_us && <div style={{ fontSize: 11.5 }}>▶ 次(自社)：{m.next_action_us}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })()}
    </>
  );
}
