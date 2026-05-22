"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Icons } from "./icons";
import { createMeeting } from "@/lib/actions";
import { MEETING_SENTIMENTS, MEETING_RELATIONS, MEETING_OWNERS, MEETING_COMPETITORS, MEETING_TAGS } from "@/lib/proposal-constants";

const SENT_TONE: Record<string, string> = { "👍ポジティブ": "#1aa260", "😐中立": "#6b7280", "👎ネガティブ": "#d23f57", "⚠️競合比較": "#d98a2b" };
const dateLabel = (d: string | null) => { if (!d) return "—"; const t = new Date(d); return isNaN(t.getTime()) ? "—" : `${t.getFullYear()}/${t.getMonth() + 1}/${t.getDate()}`; };

const empty = {
  company_name: "", meeting_date: "", their_contact: "", our_owner: "", new_or_existing: "新規",
  relation_status: "🆕新規", fb_sentiment: "😐中立", ai_summary: "", enger_fb: "", hit_points: "",
  miss_points: "", needs: "", strategy: "", next_action_us: "", next_action_them: "",
  competitors: [] as string[], competitor_detail: "", tags: [] as string[], transcript_url: "", publishable: "配信可能",
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

function MeetingForm({ companies, onDone }: { companies: string[]; onDone: () => void }) {
  const router = useRouter();
  const [f, setF] = useState({ ...empty });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: string, v: any) => setF((p) => ({ ...p, [k]: v }));
  const toggle = (k: "competitors" | "tags", v: string) => setF((p) => ({ ...p, [k]: p[k].includes(v) ? p[k].filter((x) => x !== v) : [...p[k], v] }));

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
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
        <div><L>相手企業 *</L><input style={inp} list="company-list" value={f.company_name} onChange={(e) => set("company_name", e.target.value)} placeholder="企業名" /><datalist id="company-list">{companies.map((c) => <option key={c} value={c} />)}</datalist></div>
        <div><L>打ち合わせ日</L><input style={inp} type="date" value={f.meeting_date} onChange={(e) => set("meeting_date", e.target.value)} /></div>
        <div><L>自社担当者</L><select style={inp} value={f.our_owner} onChange={(e) => set("our_owner", e.target.value)}><option value="">—</option>{MEETING_OWNERS.map((o) => <option key={o}>{o}</option>)}</select></div>
        <div><L>相手側担当者</L><input style={inp} value={f.their_contact} onChange={(e) => set("their_contact", e.target.value)} /></div>
        <div><L>新規/既存</L><select style={inp} value={f.new_or_existing} onChange={(e) => set("new_or_existing", e.target.value)}><option>新規</option><option>既存</option></select></div>
        <div><L>関係性ステータス</L><select style={inp} value={f.relation_status} onChange={(e) => set("relation_status", e.target.value)}>{MEETING_RELATIONS.map((o) => <option key={o}>{o}</option>)}</select></div>
        <div><L>FB感情</L><select style={inp} value={f.fb_sentiment} onChange={(e) => set("fb_sentiment", e.target.value)}>{MEETING_SENTIMENTS.map((o) => <option key={o}>{o}</option>)}</select></div>
        <div><L>配信可否</L><select style={inp} value={f.publishable} onChange={(e) => set("publishable", e.target.value)}><option>配信可能</option><option>配信不可</option></select></div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div><L>AI要約 / メモ</L><textarea style={{ ...inp, resize: "vertical" }} rows={3} value={f.ai_summary} onChange={(e) => set("ai_summary", e.target.value)} /></div>
        <div><L>エンジャーへのFB</L><textarea style={{ ...inp, resize: "vertical" }} rows={3} value={f.enger_fb} onChange={(e) => set("enger_fb", e.target.value)} /></div>
        <div><L>刺さった訴求点</L><textarea style={{ ...inp, resize: "vertical" }} rows={2} value={f.hit_points} onChange={(e) => set("hit_points", e.target.value)} /></div>
        <div><L>響かなかった点</L><textarea style={{ ...inp, resize: "vertical" }} rows={2} value={f.miss_points} onChange={(e) => set("miss_points", e.target.value)} /></div>
        <div><L>顧客の課題・ニーズ</L><textarea style={{ ...inp, resize: "vertical" }} rows={2} value={f.needs} onChange={(e) => set("needs", e.target.value)} /></div>
        <div><L>戦略的示唆</L><textarea style={{ ...inp, resize: "vertical" }} rows={2} value={f.strategy} onChange={(e) => set("strategy", e.target.value)} /></div>
        <div><L>次回アクション(自社)</L><input style={inp} value={f.next_action_us} onChange={(e) => set("next_action_us", e.target.value)} /></div>
        <div><L>次回アクション(相手)</L><input style={inp} value={f.next_action_them} onChange={(e) => set("next_action_them", e.target.value)} /></div>
      </div>
      <div><L>競合・他社言及</L><Chips all={MEETING_COMPETITORS} sel={f.competitors} onToggle={(v) => toggle("competitors", v)} /></div>
      <div><L>競合言及の詳細</L><input style={inp} value={f.competitor_detail} onChange={(e) => set("competitor_detail", e.target.value)} /></div>
      <div><L>横串タグ</L><Chips all={MEETING_TAGS} sel={f.tags} onToggle={(v) => toggle("tags", v)} /></div>
      <div><L>元文字起こしリンク(Drive)</L><input style={inp} value={f.transcript_url} onChange={(e) => set("transcript_url", e.target.value)} placeholder="https://drive.google.com/..." /></div>
      {err && <div style={{ color: "var(--color-danger)", fontSize: 12 }}>{err}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" className="btn brand" disabled={saving} onClick={submit}>{saving ? "保存中…" : "記録を保存"}</button>
        <button type="button" className="btn ghost" onClick={onDone}>キャンセル</button>
      </div>
    </div>
  );
}

export function MeetingsClient({ meetings, companies }: { meetings: any[]; companies: string[] }) {
  const [show, setShow] = useState(false);
  const [sent, setSent] = useState("");
  const [rel, setRel] = useState("");
  const [q, setQ] = useState("");

  const filtered = useMemo(() => meetings.filter((m) =>
    (!sent || m.fb_sentiment === sent) && (!rel || m.relation_status === rel) &&
    (!q.trim() || (m.company_name ?? "").includes(q.trim()) || (m.title ?? "").includes(q.trim()))
  ), [meetings, sent, rel, q]);

  const sel = { fontFamily: "inherit", fontSize: 12, padding: "6px 10px", borderRadius: 99, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)" } as const;

  return (
    <>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn brand" onClick={() => setShow((v) => !v)}><Icons.plus /><span>{show ? "フォームを閉じる" : "打合せを記録"}</span></button>
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
