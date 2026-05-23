"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Icons } from "./icons";
import { createMeeting, setMeetingFollowDone } from "@/lib/actions";
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
  company_name: "", meeting_date: "", their_contact: "", our_owner: "", new_or_existing: "新規",
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

function MeetingForm({ companies, onDone }: { companies: string[]; onDone: () => void }) {
  const router = useRouter();
  const [f, setF] = useState({ ...empty });
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
    const res = await createMeeting(f);
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
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" className="btn brand" disabled={saving} onClick={submit}>{saving ? "保存中…" : "記録を保存"}</button>
        <button type="button" className="btn ghost" onClick={onDone}>キャンセル</button>
      </div>
    </div>
  );
}

export function MeetingsClient({ meetings, companies }: { meetings: any[]; companies: string[] }) {
  const router = useRouter();
  const [show, setShow] = useState(false);
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
        <button className="btn brand" onClick={() => setShow((v) => !v)}><Icons.plus /><span>{show ? "フォームを閉じる" : "打合せを記録"}</span></button>
        <button onClick={() => setOnlyFollow((v) => !v)} style={{ padding: "6px 12px", borderRadius: 99, fontSize: 12, fontWeight: 700, fontFamily: "inherit", cursor: "pointer", border: `1px solid ${onlyFollow ? "#d98a2b" : "var(--color-border-strong)"}`, background: onlyFollow ? "#fff1e6" : "var(--color-surface)", color: onlyFollow ? "#b45309" : "var(--color-ink-3)" }}>🔔 要フォロー {followCount}</button>
        <div className="tbl-search" style={{ width: 220, flex: "0 0 220px" }}><Icons.search /><input placeholder="企業名で検索…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <select style={sel} value={sent} onChange={(e) => setSent(e.target.value)}><option value="">FB感情：すべて</option>{MEETING_SENTIMENTS.map((o) => <option key={o}>{o}</option>)}</select>
        <select style={sel} value={rel} onChange={(e) => setRel(e.target.value)}><option value="">関係性：すべて</option>{MEETING_RELATIONS.map((o) => <option key={o}>{o}</option>)}</select>
      </div>

      {show && <MeetingForm companies={companies} onDone={() => setShow(false)} />}

      {filtered.length === 0 ? (
        <div className="card" style={{ textAlign: "center", color: "var(--color-ink-4)", padding: 40 }}>記録がありません。「打合せを記録」から追加してください。</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 16 }}>
          {filtered.map((m) => {
            const tone = SENT_TONE[m.fb_sentiment] ?? "#6b7280";
            return (
              <div key={m.id} className="card" style={{ display: "flex", flexDirection: "column", gap: 10, borderTop: `3px solid ${tone}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{m.company_name ?? "—"}</div>
                    <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{dateLabel(m.meeting_date)} · {m.our_owner ?? "—"}{m.their_contact ? ` / 先方 ${m.their_contact}` : ""}</div>
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
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
